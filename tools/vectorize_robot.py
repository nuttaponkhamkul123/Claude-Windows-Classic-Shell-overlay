"""Vectorize a flat-colour mascot PNG into a clean, smooth SVG.

Usage:
    python tools/vectorize_robot.py <input.png> <output.svg> [--colors 7] [--scale 4]

Pipeline
  1. Upscale (Lanczos) + edge-preserving smoothing so traced curves are not jaggy.
  2. Remove the near-white background (flood fill from the border, so white
     eye highlights inside the drawing are kept).
  3. Quantize the drawing to N flat colours with k-means (OpenCV).
  4. Stack the colour layers painter-style: each layer's shape is the union of
     itself and every layer drawn above it, so layers never leave gaps.
  5. Trace each layer (contours with holes), simplify, and fit smooth
     Catmull-Rom → cubic Bézier curves.
  6. Write the SVG at the original pixel size, plus a data-headshot="x y size"
     hint (used by the HUD to crop the avatar to the head).

Needs: numpy, pillow, opencv-python-headless
"""
import argparse
import json
import sys

import cv2
import numpy as np
from PIL import Image


def load(path, scale):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    big = im.resize((w * scale, h * scale), Image.LANCZOS)
    arr = np.array(big)
    # smooth flat areas, keep edges (removes JPEG/AI-noise speckle)
    arr = cv2.bilateralFilter(arr, 9, 40, 9)
    arr = cv2.medianBlur(arr, 5)
    return arr, (w, h)


def foreground_mask(rgb):
    """Everything that isn't the white page connected to the image border."""
    light = (rgb.min(axis=2) > 232).astype(np.uint8)
    h, w = light.shape
    flood = light.copy()
    ff = np.zeros((h + 2, w + 2), np.uint8)
    # fill the background starting from every border pixel that is light
    for x in range(0, w, 8):
        for y in (0, h - 1):
            if flood[y, x] == 1:
                cv2.floodFill(flood, ff, (x, y), 2)
    for y in range(0, h, 8):
        for x in (0, w - 1):
            if flood[y, x] == 1:
                cv2.floodFill(flood, ff, (x, y), 2)
    fg = (flood != 2).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return fg


def quantize(rgb, fg, k):
    pts = rgb[fg == 1].astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.5)
    _, labels, centers = cv2.kmeans(pts, k, None, crit, 6, cv2.KMEANS_PP_CENTERS)
    lab = np.full(fg.shape, -1, np.int32)
    lab[fg == 1] = labels.ravel()
    return lab, centers.astype(np.uint8)


def clean_labels(lab, k, radius):
    """Mode filter: each pixel takes the most common label around it (kills specks)."""
    h, w = lab.shape
    votes = np.zeros((k, h, w), np.float32)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)).astype(np.float32)
    for i in range(k):
        votes[i] = cv2.filter2D((lab == i).astype(np.float32), -1, kernel)
    out = votes.argmax(axis=0).astype(np.int32)
    out[lab < 0] = -1
    return out


def catmull_rom_path(pts, s):
    """Closed polyline -> smooth cubic Bézier path string (scaled by 1/s)."""
    n = len(pts)
    p = pts.astype(np.float64) / s
    f = lambda v: f"{v[0]:.1f},{v[1]:.1f}"
    d = [f"M{f(p[0])}"]
    for i in range(n):
        p0, p1, p2, p3 = p[i - 1], p[i], p[(i + 1) % n], p[(i + 2) % n]
        c1 = p1 + (p2 - p0) / 6.0
        c2 = p2 - (p3 - p1) / 6.0
        d.append(f"C{f(c1)} {f(c2)} {f(p2)}")
    d.append("Z")
    return "".join(d)


def trace(mask, s, min_area, eps):
    contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    parts = []
    for c in contours:
        if abs(cv2.contourArea(c)) < min_area:
            continue
        approx = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(approx) < 3:
            continue
        parts.append(catmull_rom_path(approx, s))
    return "".join(parts)


def head_box(fg, s, torso=False, below=0.18):
    """Square avatar box. From the top of the drawing (hair) down to the neck plus
    `below` × head height (neck + top of the shoulders), or with torso=True down to
    the hips (where the silhouette narrows into the legs)."""
    rows = fg.sum(axis=1)
    ys = np.nonzero(rows)[0]
    top, bottom = ys[0], ys[-1]
    h = bottom - top
    # the head is the widest part in the upper half; the neck is the narrowest row after it
    upper = rows[top: top + int(h * 0.55)]
    widest = top + int(np.argmax(upper))
    after = rows[widest: top + int(h * 0.65)]
    neck = widest + int(np.argmin(after))
    end = min(bottom, neck + int((neck - top) * below))
    if torso:
        # torso = widest part below the neck; hips = first row below it that is clearly narrower
        lower = rows[neck: top + int(h * 0.95)]
        chest = neck + int(np.argmax(lower))
        hips = chest
        while hips < bottom and rows[hips] > rows[chest] * 0.75:
            hips += 1
        end = hips
    xs = np.nonzero(fg[top:end].sum(axis=0))[0]
    x0, x1 = xs[0], xs[-1]
    size = max(end - top, x1 - x0) * 1.04
    cx = (x0 + x1) / 2
    # bottom-aligned: the chin sits on the bottom edge, any spare room goes above the hair
    return ((cx - size / 2) / s, (end - size) / s, size / s)


def find_eyes(lab, centers, fg, s):
    """Locate the two eyes: the biggest white blobs in the upper part of the figure.
    Returns [(cx, cy, rx, ry, skin_label, rim_px)] in scaled pixels, left to right."""
    lum = centers.astype(float) @ [0.299, 0.587, 0.114]
    white, dark = int(np.argmax(lum)), int(np.argmin(lum))
    ys = np.nonzero(fg.sum(axis=1))[0]
    top, bottom = ys[0], ys[-1]
    limit = top + int((bottom - top) * 0.55)
    n, comp, stats, cent = cv2.connectedComponentsWithStats((lab == white).astype(np.uint8))
    cand = [i for i in range(1, n) if cent[i][1] < limit and stats[i][cv2.CC_STAT_AREA] > (6 * s) ** 2]
    cand = sorted(cand, key=lambda i: -stats[i][cv2.CC_STAT_AREA])[:2]
    eyes = []
    for i in sorted(cand, key=lambda i: cent[i][0]):
        m = (comp == i).astype(np.uint8)
        # fill the pupil holes
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        filled = np.zeros_like(m)
        cv2.drawContours(filled, cnts, -1, 1, -1)
        # grow outward through the dark outline ring
        k = np.ones((3, 3), np.uint8)
        grown, rim = filled, 0
        for _ in range(12 * s):
            nxt = cv2.dilate(grown, k)
            ring = (nxt == 1) & (grown == 0)
            if (lab[ring] == dark).mean() < 0.5:
                break
            grown, rim = nxt, rim + 1
        bx, by, w, h = cv2.boundingRect(grown)
        cx, cy = bx + w / 2, by + h / 2
        # skin = most common colour just outside the eye
        out = cv2.dilate(grown, k, iterations=3 * s) - grown
        around = lab[(out == 1) & (lab != dark) & (lab != white) & (lab >= 0)]
        skin = int(np.bincount(around).argmax()) if around.size else dark
        eyes.append((cx, cy, w / 2, h / 2, skin, rim))
    return eyes


def blink_svg(eyes, centers, s, dark):
    """Eyelids that drop over each eye and lift again (CSS animation inside the SVG,
    so it also plays when the SVG is used as an <img>)."""
    hexc = lambda c: "#{:02x}{:02x}{:02x}".format(*(int(v) for v in c))
    defs, lids = [], []
    # how far the lids travel (same for both eyes so one keyframe set fits both)
    travel = max(e[3] for e in eyes) / s * 2 + 12
    for n, (cx, cy, rx, ry, skin, rim) in enumerate(eyes):
        cx, cy, rx, ry, rim = cx / s, cy / s, rx / s, ry / s, rim / s
        pad = 1.8                     # a bit past the outline ring, so it can't peek out
        defs.append(f'<clipPath id="eye{n}"><ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx + pad:.1f}" ry="{ry + pad:.1f}"/></clipPath>')
        x0, x1 = cx - rx - 2, cx + rx + 2
        y_top, y_bot = cy - ry - 4, cy + ry + 4
        sag = ry * 0.22
        sw = max(1.6, rim * 0.85)
        dark_c, skin_c = hexc(centers[dark]), hexc(centers[skin])
        # the lid: covers the whole eye when down; its lower edge is a soft curve with a dark rim
        lid = f"M{x0:.1f},{y_top:.1f} H{x1:.1f} V{y_bot:.1f} Q{cx:.1f},{y_bot + 2 * sag:.1f} {x0:.1f},{y_bot:.1f} Z"
        edge = f"M{x0:.1f},{y_bot:.1f} Q{cx:.1f},{y_bot + 2 * sag:.1f} {x1:.1f},{y_bot:.1f}"
        # the closed eye: a gentle downward curve just below the middle (shown only while shut)
        cl_y = cy + ry * 0.1
        closed = f"M{cx - rx * 0.62:.1f},{cl_y:.1f} Q{cx:.1f},{cl_y + ry * 0.42:.1f} {cx + rx * 0.62:.1f},{cl_y:.1f}"
        lids.append(
            f'<g clip-path="url(#eye{n})"><g class="lid">'
            f'<path d="{lid}" fill="{skin_c}"/>'
            f'<path d="{edge}" fill="none" stroke="{dark_c}" stroke-width="{sw:.1f}"/>'
            f"</g></g>"
            f'<path class="shut" d="{closed}" fill="none" stroke="{dark_c}" stroke-width="{sw:.1f}" stroke-linecap="round"/>'
        )
    style = (
        "<style>"
        f".lid{{transform:translateY(-{travel:.0f}px);"
        "animation:blink 5.2s infinite;animation-delay:0s}"
        ".shut{opacity:0;animation:shut 5.2s infinite;animation-delay:0s}"
        f"@keyframes blink{{0%,91%,100%{{transform:translateY(-{travel:.0f}px)}}94%,96.5%{{transform:translateY(0)}}}}"
        "@keyframes shut{0%,93.5%,97%,100%{opacity:0}94%,96.5%{opacity:1}}"
        "@media (prefers-reduced-motion:reduce){.lid,.shut{animation:none}}"
        "</style>"
    )
    return f"<defs>{''.join(defs)}</defs>\n{style}\n<g>{''.join(lids)}</g>\n"


def anchors(fg, s, eyes):
    """Key points of the figure (original pixels) so the HUD can fit hats, glasses and
    clothes on it: head top / centre / width, neck, hips and the eyes."""
    rows = fg.sum(axis=1)
    ys = np.nonzero(rows)[0]
    top, bottom = ys[0], ys[-1]
    h = bottom - top
    upper = rows[top: top + int(h * 0.55)]
    widest = top + int(np.argmax(upper))
    neck = widest + int(np.argmin(rows[widest: top + int(h * 0.65)]))
    head_top = top + int(np.argmax(upper >= rows[widest] * 0.5))   # skips the hair tuft
    xs = np.nonzero(fg[widest])[0]
    lower = rows[neck: top + int(h * 0.95)]
    chest = neck + int(np.argmax(lower))
    hips = chest
    while hips < bottom and rows[hips] > rows[chest] * 0.75:
        hips += 1
    r = lambda v: round(float(v) / s, 1)
    return {
        "top": r(top), "headTop": r(head_top), "headY": r(widest),
        "headCx": r((xs[0] + xs[-1]) / 2), "headW": r(xs[-1] - xs[0]),
        "neck": r(neck), "hips": r(hips), "bottom": r(bottom),
        "eyes": [[r(e[0]), r(e[1]), r(e[2]), r(e[3])] for e in eyes],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--colors", type=int, default=7)
    ap.add_argument("--scale", type=int, default=4)
    ap.add_argument("--smooth", type=float, default=3.0,
                    help="speck-removal radius in original pixels (higher = flatter colour areas)")
    ap.add_argument("--no-blink", action="store_true", help="don't add the blinking eyelids")
    a = ap.parse_args()

    rgb, (W, H) = load(a.src, a.scale)
    fg = foreground_mask(rgb)
    lab, centers = quantize(rgb, fg, a.colors)
    lab = clean_labels(lab, a.colors, radius=max(1, round(a.smooth * a.scale)))

    # Paint order: big areas first, small details (eyes, highlights) last.
    # The darkest colour (outline) goes first so it sits under everything as a rim.
    areas = np.array([(lab == i).sum() for i in range(a.colors)])
    lum = centers.astype(float) @ [0.299, 0.587, 0.114]
    darkest = int(np.argmin(lum))
    order = [darkest] + [i for i in np.argsort(-areas) if i != darkest]

    min_area = (1.2 * a.scale) ** 2
    eps = 0.55 * a.scale
    paths = []
    for idx, i in enumerate(order):
        mask = np.isin(lab, order[idx:]).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        d = trace(mask, a.scale, min_area, eps)
        if d:
            r, g, b = (int(v) for v in centers[i])
            # the first layer is the whole silhouette (outline colour) — the HUD clips clothes to it
            # the second is every non-outline area — clothes are clipped to it, so the outline stays on top
            pid = ' id="silhouette"' if idx == 0 else (' id="body"' if idx == 1 else "")
            paths.append(f'<path{pid} fill="#{r:02x}{g:02x}{b:02x}" d="{d}"/>')

    hx, hy, hs = head_box(fg, a.scale)
    blink = ""
    eyes = find_eyes(lab, centers, fg, a.scale)
    anc = anchors(fg, a.scale, eyes)
    if not a.no_blink:
        if len(eyes) == 2:
            blink = blink_svg(eyes, centers, a.scale, darkest)
            print("eyes:", [(round(e[0] / a.scale, 1), round(e[1] / a.scale, 1), round(e[2] / a.scale, 1), round(e[3] / a.scale, 1)) for e in eyes])
        else:
            print(f"warning: found {len(eyes)} eye(s), not adding the blink")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
        f'data-headshot="{hx:.1f} {hy:.1f} {hs:.1f}" '
        f"data-anchors='{json.dumps(anc, separators=(',', ':'))}'>\n"
        f"<title>Robot 1 Small</title>\n"
        f'<g fill-rule="evenodd" stroke="none">\n' + "\n".join(paths) + "\n</g>\n" + blink + "</svg>\n"
    )
    with open(a.dst, "w", encoding="utf-8") as fh:
        fh.write(svg)
    print(f"wrote {a.dst}: {len(paths)} layers, {len(svg) // 1024} KB, headshot=({hx:.1f},{hy:.1f},{hs:.1f})")
    print("palette:", " ".join(f"#{int(c[0]):02x}{int(c[1]):02x}{int(c[2]):02x}" for c in centers[order]))


if __name__ == "__main__":
    sys.exit(main())
