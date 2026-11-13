// Robot dress-up: hats, glasses and clothes drawn as SVG on top of the robot avatar.
// Loaded before app.js. Everything is placed from the robot's data-anchors
// (written by tools/vectorize_robot.py), so it still fits after re-vectorizing.
//
//   window.ROBOT_OUTFIT_CATALOG          — items + default colours (for the Dress-up panel)
//   window.decorateRobotSvg(svg, outfit)  — returns the SVG text with the outfit added
//   window.robotOutfitFor(session)        — saved outfit for a chat (or the "all robots" one)
//   window.setRobotOutfit(id, outfit)     — save ('*' = all robots) and refresh avatars
(function () {
  const SWATCHES = ['#e0483e', '#f08a24', '#f2c230', '#3faa4a', '#1fa6a0', '#2f6fd6',
    '#7a4fd6', '#e85a9c', '#8a5a3c', '#2b2f3a', '#f2f4f7'];

  const CATALOG = {
    hat: [
      { id: 'tophat', label: 'Top hat', icon: '🎩', color: '#c0392b' },
      { id: 'cap', label: 'Cap', icon: '🧢', color: '#2f6fd6' },
      { id: 'beanie', label: 'Beanie', icon: '🧶', color: '#e0483e' },
      { id: 'party', label: 'Party', icon: '🥳', color: '#7a4fd6' },
      { id: 'crown', label: 'Crown', icon: '👑', color: '#e0483e' },
      { id: 'headphones', label: 'Headphones', icon: '🎧', color: '#e0483e' },
    ],
    glasses: [
      { id: 'round', label: 'Round', icon: '👓', color: '#3a3f4b' },
      { id: 'shades', label: 'Shades', icon: '🕶️', color: '#c9a227' },
      { id: 'nerd', label: 'Nerd', icon: '🤓', color: '#1f2228' },
      { id: 'hearts', label: 'Hearts', icon: '💖', color: '#e85a9c' },
      { id: 'monocle', label: 'Monocle', icon: '🧐', color: '#c9a227' },
    ],
    clothes: [
      { id: 'shirt', label: 'Shirt', icon: '👕', color: '#3faa4a' },
      { id: 'hoodie', label: 'Hoodie', icon: '🧥', color: '#7a4fd6' },
      { id: 'suit', label: 'Suit', icon: '👔', color: '#e0483e' },
      { id: 'sweater', label: 'Striped', icon: '🎽', color: '#e0483e' },
      { id: 'overalls', label: 'Overalls', icon: '👖', color: '#f2c230' },
      { id: 'scarf', label: 'Scarf', icon: '🧣', color: '#e0483e' },
    ],
  };
  window.ROBOT_OUTFIT_CATALOG = { ...CATALOG, swatches: SWATCHES };

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const itemOf = (kind, id) => CATALOG[kind].find((x) => x.id === id) || null;

  // lighten (amt > 0) or darken (amt < 0) a #rrggbb colour
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
  }
  const f = (v) => Math.round(v * 10) / 10;

  // ---------------- geometry from the robot ----------------
  function geometry(svg) {
    const m = svg.match(/data-anchors='([^']*)'/);
    if (!m) return null;
    let A;
    try { A = JSON.parse(m[1]); } catch (_) { return null; }
    if (!A || !Array.isArray(A.eyes) || A.eyes.length !== 2) return null;
    const rx = A.headW / 2;
    const ry = (A.headY - A.headTop) / 0.866; // headTop = where the head is half its full width
    const outline = (svg.match(/id="silhouette"[^>]*fill="(#[0-9a-fA-F]{6})"/) || [])[1] || '#1a2b57';
    const [L, R] = A.eyes[0][0] < A.eyes[1][0] ? A.eyes : [A.eyes[1], A.eyes[0]];
    return { A, cx: A.headCx, hy: A.headY, rx, ry, top: A.headY - ry, L, R, OL: outline };
  }

  // ---------------- hats → { svg, top, hideHair } ----------------
  const HATS = {
    tophat(g, c) {
      const b = g.top + 16, w = g.rx * 1.05, ct = b - 64;
      return {
        top: ct - 8, hideHair: true,
        svg: `<g transform="rotate(-8 ${f(g.cx)} ${f(b)})" stroke="${g.OL}" stroke-width="4" stroke-linejoin="round">
          <rect x="${f(g.cx - w / 2)}" y="${f(ct)}" width="${f(w)}" height="64" rx="6" fill="#2b2f3a"/>
          <rect x="${f(g.cx - w / 2)}" y="${f(b - 22)}" width="${f(w)}" height="13" fill="${c}"/>
          <ellipse cx="${f(g.cx)}" cy="${f(b)}" rx="${f(g.rx * 0.95)}" ry="9" fill="#2b2f3a"/>
          <rect x="${f(g.cx - w / 2 + 8)}" y="${f(ct + 8)}" width="7" height="30" rx="3" fill="#ffffff" fill-opacity="0.18" stroke="none"/>
        </g>`,
      };
    },
    beanie(g, c) {
      const R1 = g.rx + 5, R2 = g.ry + 5, yb = g.top + g.ry * 0.55;
      const w = R1 * Math.sqrt(Math.max(0, 1 - ((g.hy - yb) / R2) ** 2));
      const ribs = [-2, -1, 0, 1, 2].map((k) =>
        `<path d="M${f(g.cx + k * w * 0.32)},${f(yb - 14)} Q${f(g.cx + k * w * 0.26)},${f(g.top + 10)} ${f(g.cx + k * w * 0.1)},${f(g.top)}" stroke="${shade(c, -0.18)}" stroke-width="3" fill="none"/>`).join('');
      return {
        top: g.top - 22, hideHair: true,
        svg: `<g stroke-linejoin="round">
          <path d="M${f(g.cx - w)},${f(yb)} A${f(R1)} ${f(R2)} 0 0 1 ${f(g.cx + w)},${f(yb)} Z" fill="${c}" stroke="${g.OL}" stroke-width="4"/>
          ${ribs}
          <rect x="${f(g.cx - w - 4)}" y="${f(yb - 17)}" width="${f(2 * w + 8)}" height="20" rx="9" fill="${shade(c, -0.2)}" stroke="${g.OL}" stroke-width="4"/>
          <circle cx="${f(g.cx)}" cy="${f(g.top - 6)}" r="13" fill="#f4f4f4" stroke="${g.OL}" stroke-width="3.5"/>
        </g>`,
      };
    },
    cap(g, c) {
      const R1 = g.rx + 4, R2 = g.ry + 4, yb = g.top + g.ry * 0.45;
      const w = R1 * Math.sqrt(Math.max(0, 1 - ((g.hy - yb) / R2) ** 2));
      return {
        top: g.top - 12, hideHair: true,
        svg: `<g stroke="${g.OL}" stroke-width="4" stroke-linejoin="round">
          <path d="M${f(g.cx - w)},${f(yb)} A${f(R1)} ${f(R2)} 0 0 1 ${f(g.cx + w)},${f(yb)} Z" fill="${c}"/>
          <path d="M${f(g.cx)},${f(g.top - 2)} V${f(yb - 2)}" stroke="${shade(c, -0.25)}" stroke-width="3" fill="none"/>
          <circle cx="${f(g.cx + w * 0.3)}" cy="${f(yb - 18)}" r="9" fill="#ffffff" stroke-width="3"/>
          <ellipse cx="${f(g.cx)}" cy="${f(yb + 3)}" rx="${f(w * 0.98)}" ry="10" fill="${shade(c, -0.22)}"/>
          <circle cx="${f(g.cx)}" cy="${f(g.top - 4)}" r="5" fill="${shade(c, -0.22)}" stroke-width="3"/>
        </g>`,
      };
    },
    party(g, c) {
      const b = g.top + 12, hw = 34, apex = b - 74;
      const dots = [[-14, -16], [10, -30], [-4, -48], [16, -10], [-20, -4]].map(([dx, dy]) =>
        `<circle cx="${f(g.cx + dx)}" cy="${f(b + dy)}" r="4.5" fill="#ffffff" stroke="none"/>`).join('');
      return {
        top: apex - 12, hideHair: true,
        svg: `<g transform="rotate(-10 ${f(g.cx)} ${f(b)})" stroke="${g.OL}" stroke-width="4" stroke-linejoin="round">
          <path d="M${f(g.cx - hw)},${f(b)} L${f(g.cx)},${f(apex)} L${f(g.cx + hw)},${f(b)} Q${f(g.cx)},${f(b + 10)} ${f(g.cx - hw)},${f(b)} Z" fill="${c}"/>
          ${dots}
          <circle cx="${f(g.cx)}" cy="${f(apex - 2)}" r="9" fill="#f2c230"/>
        </g>`,
      };
    },
    crown(g, c) {
      const b = g.top + 18, h = 42, x = (d) => f(g.cx + d);
      const pts = [[-48, 0], [-48, -h], [-36, -h * 0.45], [-24, -h], [-12, -h * 0.45], [0, -h], [12, -h * 0.45],
        [24, -h], [36, -h * 0.45], [48, -h], [48, 0]].map(([dx, dy]) => `${x(dx)},${f(b + dy)}`).join(' ');
      const gems = [-48, -24, 0, 24, 48].map((dx) => `<circle cx="${x(dx)}" cy="${f(b - h)}" r="5" fill="${c}"/>`).join('');
      return {
        top: b - h - 8, hideHair: true,
        svg: `<g stroke="${g.OL}" stroke-width="4" stroke-linejoin="round">
          <polygon points="${pts}" fill="#f2c230"/>
          <rect x="${x(-48)}" y="${f(b - 12)}" width="96" height="12" fill="#e0a91c"/>
          <circle cx="${x(0)}" cy="${f(b - 6)}" r="4" fill="${c}" stroke-width="2.5"/>
          ${gems}
        </g>`,
      };
    },
    headphones(g, c) {
      const y = g.hy - 8;
      return {
        top: g.top - 14, hideHair: false,
        svg: `<g stroke-linejoin="round">
          <path d="M${f(g.cx - g.rx + 2)},${f(y)} A${f(g.rx + 6)} ${f(g.ry + 10)} 0 0 1 ${f(g.cx + g.rx - 2)},${f(y)}" fill="none" stroke="${g.OL}" stroke-width="13"/>
          <path d="M${f(g.cx - g.rx + 2)},${f(y)} A${f(g.rx + 6)} ${f(g.ry + 10)} 0 0 1 ${f(g.cx + g.rx - 2)},${f(y)}" fill="none" stroke="#3a3f4b" stroke-width="6"/>
          <rect x="${f(g.cx - g.rx - 12)}" y="${f(y - 26)}" width="24" height="50" rx="10" fill="${c}" stroke="${g.OL}" stroke-width="4"/>
          <rect x="${f(g.cx + g.rx - 12)}" y="${f(y - 26)}" width="24" height="50" rx="10" fill="${c}" stroke="${g.OL}" stroke-width="4"/>
        </g>`,
      };
    },
  };

  // ---------------- glasses ----------------
  const GLASSES = {
    round(g, c) {
      const r = Math.max(g.L[2], g.L[3]) + 3, r2 = Math.max(g.R[2], g.R[3]) + 3;
      const y = (g.L[1] + g.R[1]) / 2;
      const lens = (e, rr) => `<circle cx="${f(e[0])}" cy="${f(e[1])}" r="${f(rr)}" fill="#ffffff" fill-opacity="0.14"/>
        <path d="M${f(e[0] - rr * 0.55)},${f(e[1] - rr * 0.5)} Q${f(e[0] - rr * 0.2)},${f(e[1] - rr * 0.8)} ${f(e[0] + rr * 0.2)},${f(e[1] - rr * 0.72)}" stroke="#ffffff" stroke-opacity="0.7" stroke-width="3" fill="none"/>`;
      return `<g fill="none" stroke="${c}" stroke-width="4.5" stroke-linecap="round">
        ${lens(g.L, r)}${lens(g.R, r2)}
        <path d="M${f(g.L[0] + r - 1)},${f(y - 6)} Q${f((g.L[0] + g.R[0]) / 2)},${f(y - 16)} ${f(g.R[0] - r2 + 1)},${f(y - 6)}"/>
        <path d="M${f(g.L[0] - r)},${f(g.L[1] - 4)} L${f(g.cx - g.rx + 3)},${f(y - 10)}"/>
        <path d="M${f(g.R[0] + r2)},${f(g.R[1] - 4)} L${f(g.cx + g.rx - 3)},${f(y - 10)}"/>
      </g>`;
    },
    shades(g, c) {
      const lens = (e) => {
        const rx = e[2] + 9, ry = e[3] * 0.72, y = e[1] + 2;
        return `<ellipse cx="${f(e[0])}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="#15171c" fill-opacity="0.94" stroke="${c}" stroke-width="3.5"/>
          <path d="M${f(e[0] - rx * 0.55)},${f(y - ry * 0.25)} L${f(e[0] - rx * 0.05)},${f(y - ry * 0.7)}" stroke="#ffffff" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round"/>`;
      };
      const y = (g.L[1] + g.R[1]) / 2 - g.L[3] * 0.45;
      return `<g>${lens(g.L)}${lens(g.R)}
        <path d="M${f(g.L[0] + g.L[2] + 8)},${f(y)} Q${f((g.L[0] + g.R[0]) / 2)},${f(y - 8)} ${f(g.R[0] - g.R[2] - 8)},${f(y)}" stroke="${c}" stroke-width="4" fill="none"/>
        <path d="M${f(g.L[0] - g.L[2] - 9)},${f(y)} L${f(g.cx - g.rx + 3)},${f(y - 4)} M${f(g.R[0] + g.R[2] + 9)},${f(y)} L${f(g.cx + g.rx - 3)},${f(y - 4)}" stroke="${c}" stroke-width="4" fill="none"/>
      </g>`;
    },
    nerd(g, c) {
      const lens = (e) => {
        const w = e[2] * 2 + 14, h = e[3] * 1.7;
        return `<rect x="${f(e[0] - w / 2)}" y="${f(e[1] - h / 2)}" width="${f(w)}" height="${f(h)}" rx="8" fill="#ffffff" fill-opacity="0.12"/>`;
      };
      const y = (g.L[1] + g.R[1]) / 2 - 8;
      return `<g fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round">
        ${lens(g.L)}${lens(g.R)}
        <path d="M${f(g.L[0] + g.L[2] + 7)},${f(y)} H${f(g.R[0] - g.R[2] - 7)}"/>
        <path d="M${f(g.L[0] - g.L[2] - 7)},${f(y)} L${f(g.cx - g.rx + 3)},${f(y - 3)} M${f(g.R[0] + g.R[2] + 7)},${f(y)} L${f(g.cx + g.rx - 3)},${f(y - 3)}"/>
      </g>`;
    },
    hearts(g, c) {
      const heart = (e) => {
        const s = Math.max(e[2], e[3]) * 1.0, x = e[0], y = e[1] - 2;
        return `<path d="M${f(x)},${f(y + s * 0.95)} C${f(x - s * 1.5)},${f(y + s * 0.05)} ${f(x - s * 0.95)},${f(y - s * 1.05)} ${f(x)},${f(y - s * 0.38)} C${f(x + s * 0.95)},${f(y - s * 1.05)} ${f(x + s * 1.5)},${f(y + s * 0.05)} ${f(x)},${f(y + s * 0.95)} Z" fill="${c}" fill-opacity="0.6" stroke="${shade(c, -0.35)}" stroke-width="4" stroke-linejoin="round"/>`;
      };
      const y = (g.L[1] + g.R[1]) / 2 - 12;
      return `<g>${heart(g.L)}${heart(g.R)}
        <path d="M${f(g.L[0] + g.L[2] + 6)},${f(y)} Q${f((g.L[0] + g.R[0]) / 2)},${f(y - 8)} ${f(g.R[0] - g.R[2] - 6)},${f(y)}" stroke="${shade(c, -0.35)}" stroke-width="4" fill="none"/>
      </g>`;
    },
    monocle(g, c) {
      const e = g.R, r = Math.max(e[2], e[3]) + 3;
      return `<g fill="none" stroke-linecap="round">
        <circle cx="${f(e[0])}" cy="${f(e[1])}" r="${f(r)}" fill="#ffffff" fill-opacity="0.14" stroke="${c}" stroke-width="4.5"/>
        <path d="M${f(e[0] - r * 0.5)},${f(e[1] - r * 0.5)} Q${f(e[0] - r * 0.1)},${f(e[1] - r * 0.85)} ${f(e[0] + r * 0.3)},${f(e[1] - r * 0.75)}" stroke="#ffffff" stroke-opacity="0.7" stroke-width="3"/>
        <path d="M${f(e[0] + r * 0.2)},${f(e[1] + r)} Q${f(e[0] + r * 0.9)},${f(g.A.neck - 10)} ${f(e[0] + r * 0.4)},${f(g.A.neck + 24)}" stroke="${c}" stroke-width="2.5" stroke-dasharray="3 3"/>
      </g>`;
    },
  };

  // ---------------- clothes (clipped to the body, so the outline stays on top) ----------------
  const CLOTHES = {
    shirt(g, c, b) {
      return `${b.fill(c)}
        <path d="M${f(g.cx - 22)},${f(b.n + 1)} Q${f(g.cx)},${f(b.n + 18)} ${f(g.cx + 22)},${f(b.n + 1)}" stroke="${shade(c, -0.3)}" stroke-width="4" fill="none"/>
        <path d="${star(g.cx, b.n + 40, 10)}" fill="#ffffff" fill-opacity="0.9"/>`;
    },
    hoodie(g, c, b) {
      return `${b.fill(c)}
        <ellipse cx="${f(g.cx)}" cy="${f(b.n + 3)}" rx="44" ry="13" fill="${shade(c, -0.18)}" stroke="${shade(c, -0.38)}" stroke-width="3"/>
        <path d="M${f(g.cx - 10)},${f(b.n + 12)} L${f(g.cx - 13)},${f(b.n + 44)} M${f(g.cx + 10)},${f(b.n + 12)} L${f(g.cx + 13)},${f(b.n + 44)}" stroke="#f4f4f4" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="${f(g.cx - 34)}" y="${f(b.h - 34)}" width="68" height="24" rx="8" fill="${shade(c, -0.08)}" stroke="${shade(c, -0.35)}" stroke-width="3"/>`;
    },
    suit(g, c, b) {
      return `${b.fill('#2b2f3a')}
        <polygon points="${f(g.cx - 22)},${f(b.n - 2)} ${f(g.cx + 22)},${f(b.n - 2)} ${f(g.cx)},${f(b.n + 56)}" fill="#f4f6f8"/>
        <path d="M${f(g.cx - 5)},${f(b.n + 1)} H${f(g.cx + 5)} L${f(g.cx + 3)},${f(b.n + 9)} L${f(g.cx + 7)},${f(b.n + 44)} L${f(g.cx)},${f(b.n + 52)} L${f(g.cx - 7)},${f(b.n + 44)} L${f(g.cx - 3)},${f(b.n + 9)} Z" fill="${c}" stroke="${shade(c, -0.4)}" stroke-width="1.5"/>
        <path d="M${f(g.cx - 22)},${f(b.n - 2)} L${f(g.cx - 4)},${f(b.n + 60)} M${f(g.cx + 22)},${f(b.n - 2)} L${f(g.cx + 4)},${f(b.n + 60)}" stroke="#4a5162" stroke-width="3"/>
        <circle cx="${f(g.cx)}" cy="${f(b.n + 66)}" r="3.5" fill="#4a5162"/>`;
    },
    sweater(g, c, b) {
      let stripes = '';
      for (let y = b.n + 12; y < b.h; y += 17) stripes += `<rect x="-500" y="${f(y)}" width="2000" height="7" fill="#ffffff" fill-opacity="0.8"/>`;
      return `${b.fill(c)}${stripes}
        <rect x="-500" y="${f(b.n - 1)}" width="2000" height="8" fill="${shade(c, -0.22)}"/>`;
    },
    overalls(g, c, b) {
      const d = '#3d6aa8', bt = b.n + 30;
      return `${b.fill(c)}
        <rect x="-500" y="${f(b.h - 28)}" width="2000" height="40" fill="${d}"/>
        <rect x="${f(g.cx - 30)}" y="${f(bt)}" width="60" height="${f(b.h - bt)}" rx="4" fill="${d}"/>
        <path d="M${f(g.cx - 26)},${f(bt + 2)} L${f(g.cx - 44)},${f(b.n - 4)} M${f(g.cx + 26)},${f(bt + 2)} L${f(g.cx + 44)},${f(b.n - 4)}" stroke="${d}" stroke-width="10"/>
        <rect x="${f(g.cx - 14)}" y="${f(bt + 10)}" width="28" height="18" rx="3" fill="none" stroke="${shade(d, -0.3)}" stroke-width="2.5"/>
        <circle cx="${f(g.cx - 23)}" cy="${f(bt + 5)}" r="4" fill="#f2c230"/><circle cx="${f(g.cx + 23)}" cy="${f(bt + 5)}" r="4" fill="#f2c230"/>`;
    },
  };
  // scarf is drawn on top (not clipped), around the neck
  function scarf(g, c) {
    const n = g.A.neck;
    return `<g stroke="${g.OL}" stroke-width="4" stroke-linejoin="round">
      <path d="M${f(g.cx + 14)},${f(n + 4)} L${f(g.cx + 36)},${f(n + 62)} L${f(g.cx + 16)},${f(n + 66)} L${f(g.cx - 2)},${f(n + 8)} Z" fill="${shade(c, -0.08)}"/>
      <path d="M${f(g.cx + 20)},${f(n + 66)} l-2,8 M${f(g.cx + 27)},${f(n + 64)} l-1,8 M${f(g.cx + 34)},${f(n + 62)} l0,8" stroke="${shade(c, -0.08)}" stroke-width="3" stroke-linecap="round"/>
      <rect x="${f(g.cx - 50)}" y="${f(n - 9)}" width="100" height="22" rx="10" fill="${c}"/>
      <path d="M${f(g.cx - 20)},${f(n - 7)} V${f(n + 11)} M${f(g.cx + 8)},${f(n - 7)} V${f(n + 11)}" stroke="#ffffff" stroke-opacity="0.75" stroke-width="5"/>
    </g>`;
  }
  function star(x, y, r) {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      p.push(`${f(x + rr * Math.cos(a))},${f(y + rr * Math.sin(a))}`);
    }
    return `M${p.join(' L')} Z`;
  }

  // ---------------- put it together ----------------
  function normalize(o) {
    if (!o || typeof o !== 'object') return null;
    const out = {};
    for (const kind of ['hat', 'glasses', 'clothes']) {
      if (itemOf(kind, o[kind])) {
        out[kind] = o[kind];
        const col = o[kind + 'Color'];
        out[kind + 'Color'] = HEX.test(col || '') ? col.toLowerCase() : itemOf(kind, o[kind]).color;
      }
    }
    return Object.keys(out).length ? out : null;
  }

  window.decorateRobotSvg = function (svg, outfit) {
    const o = normalize(outfit);
    const g = o && geometry(svg);
    if (!g) return svg;
    let defs = '', layers = '', hatTop = null, hideHair = false;

    if (o.clothes && o.clothes !== 'scarf') {
      const b = { n: g.A.neck - 1, h: g.A.hips + 2 };
      b.fill = (col) => `<rect x="-500" y="${f(b.n)}" width="2000" height="${f(b.h - b.n)}" fill="${col}"/>`;
      defs += `<clipPath id="dress-clip"><use href="#body" clip-rule="evenodd"/></clipPath>`;
      layers += `<g clip-path="url(#dress-clip)">${CLOTHES[o.clothes](g, o.clothesColor, b)}</g>`;
    }
    if (o.clothes === 'scarf') layers += scarf(g, o.clothesColor);
    if (o.glasses) layers += GLASSES[o.glasses](g, o.glassesColor);
    if (o.hat) {
      const h = HATS[o.hat](g, o.hatColor);
      layers += h.svg;
      hatTop = h.top;
      hideHair = h.hideHair;
    }
    if (hideHair) {
      // hide the hair tuft under the hat (only above the head, where the hat covers anyway)
      defs += `<mask id="no-hair"><rect x="-500" y="-500" width="2000" height="2000" fill="#fff"/>` +
        `<rect x="${f(g.cx - 34)}" y="${f(g.A.top - 20)}" width="68" height="${f(g.top + 8 - (g.A.top - 20))}" fill="#000"/></mask>`;
      svg = svg.replace(/<g fill-rule="evenodd" stroke="none">/, '<g fill-rule="evenodd" stroke="none" mask="url(#no-hair)">');
    }
    let out = svg.replace(/<\/svg>\s*$/, `<defs>${defs}</defs><g class="outfit">${layers}</g></svg>`);

    // make room above the head for a tall hat (keeps the picture's shape, chin stays put)
    if (hatTop !== null) {
      const vb = out.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
      if (vb) {
        let [x, y, w, h] = vb.slice(1).map(Number);
        const need = y - (hatTop - 2);
        if (need > 0) {
          const nh = h + need, nw = w * nh / h;
          x -= (nw - w) / 2; y -= need; w = nw; h = nh;
          out = out.replace(vb[0], `viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}"`)
            .replace(/(<svg[^>]*?)\swidth="[^"]*"/, `$1 width="${f(w)}"`)
            .replace(/(<svg[^>]*?)\sheight="[^"]*"/, `$1 height="${f(h)}"`);
        }
      }
    }
    return out;
  };

  // ---------------- saved outfits (~/.ovly-claude/settings.json → robotOutfits) ----------------
  // { "<session id>": outfit, "*": outfit for every robot without its own }
  const outfits = {};
  window.robotOutfits = outfits;
  const api = window.electronAPI;

  window.robotOutfitFor = function (session) {
    const id = session && session.id;
    if (id && Object.prototype.hasOwnProperty.call(outfits, id)) return normalize(outfits[id]);
    return normalize(outfits['*']);
  };

  function refreshAvatars() {
    try { if (typeof renderSessionCards === 'function') renderSessionCards(true); } catch (_) {}
    try { if (typeof currentActiveSession !== 'undefined' && currentActiveSession && typeof updateConvoHeader === 'function') updateConvoHeader(currentActiveSession); } catch (_) {}
  }
  window.refreshRobotAvatars = refreshAvatars;

  // outfit = null → remove (that chat falls back to the "all robots" outfit)
  window.setRobotOutfit = function (id, outfit) {
    if (!id) return;
    if (outfit === null) delete outfits[id];
    else outfits[id] = normalize(outfit) || {}; // {} = explicitly nothing (overrides "all robots")
    api?.storeSet?.('robotOutfits', { ...outfits });
    refreshAvatars();
  };

  (api?.storeGetAll ? api.storeGetAll() : Promise.resolve({})).then((st) => {
    const saved = st && st.robotOutfits;
    if (saved && typeof saved === 'object') Object.assign(outfits, saved);
    if (Object.keys(outfits).length) refreshAvatars();
  }).catch(() => {});

  // New chat got its real id → keep the outfit picked for the draft
  api?.onReplyRekey?.(({ oldId, newId }) => {
    if (Object.prototype.hasOwnProperty.call(outfits, oldId)) {
      outfits[newId] = outfits[oldId];
      delete outfits[oldId];
      api.storeSet?.('robotOutfits', { ...outfits });
    }
  });
})();
