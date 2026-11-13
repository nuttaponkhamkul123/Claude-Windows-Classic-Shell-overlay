// Vault windows: each room has a window on its back wall looking out on a scene
// (ocean, space, a city at night…). Picked per room from its name, so a room keeps
// its view; right-click a room → Change view rolls a new one (remembered).
// All art is SVG drawn in code, in a 120×72 box that fills the frame.
// Design sheet: docs/design/windows.html. Styles: "Vault windows" in features.css.

const WINDOW_FRAMES = ['vault', 'porthole', 'pano'];
// remembered "Change view" picks: room key -> scene key
const windowViews = Object.assign({}, window.electronAPI?.settings?.windowViews || {});
const windowSpot = new Map(); // room key -> x% (stays put when furniture comes and goes)

let windowUid = 0;
const wGrad = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;

const WINDOW_SCENES = {
  ocean: (u) => `
    <defs>${wGrad('oc' + u, [[0, '#0e7490'], [.55, '#0b3b5c'], [1, '#04121f']])}</defs>
    <rect width="120" height="72" fill="url(#oc${u})"/>
    <path class="s-wave" d="M20 0 L34 0 L22 72 L4 72 Z M64 0 L74 0 L70 72 L54 72 Z" fill="#67e8f9" opacity=".07"/>
    <path d="M0 62 Q20 56 40 62 T80 60 T120 63 V72 H0 Z" fill="#0a2a24"/>
    <path d="M14 62 q-2 -10 2 -16 M18 62 q3 -8 0 -13 M98 63 q-3 -9 1 -14" stroke="#15803d" stroke-width="2" fill="none" stroke-linecap="round"/>
    <g class="s-swim" fill="#fbbf24"><path d="M10 28 l8 -3 l0 6 z M18 28 l4 -3 v6 z"/><path d="M2 36 l6 -2 v4 z M8 36 l3 -2 v4 z" opacity=".8"/></g>
    <g class="s-swim-2" fill="#a5f3fc" opacity=".8"><path d="M60 46 l7 -2.5 v5 z M67 46 l3 -2.5 v5 z"/></g>
    <g class="s-rise" fill="#cffafe"><circle cx="88" cy="62" r="1.3"/><circle cx="92" cy="64" r="1"/><circle cx="90" cy="60" r=".8"/></g>`,
  space: (u) => `
    <defs>${wGrad('sp' + u, [[0, '#0b0820'], [1, '#1e1b4b']])}<radialGradient id="pl${u}" cx=".35" cy=".35"><stop offset="0" stop-color="#fda4af"/><stop offset="1" stop-color="#9d174d"/></radialGradient></defs>
    <rect width="120" height="72" fill="url(#sp${u})"/>
    <ellipse cx="34" cy="50" rx="40" ry="10" fill="#7c3aed" opacity=".12"/>
    <g class="s-twinkle" fill="#fff"><circle cx="8" cy="10" r=".8"/><circle cx="22" cy="30" r=".6"/><circle cx="40" cy="8" r="1"/><circle cx="58" cy="22" r=".6"/><circle cx="70" cy="6" r=".8"/><circle cx="104" cy="14" r=".7"/><circle cx="112" cy="40" r=".9"/><circle cx="12" cy="60" r=".6"/><circle cx="50" cy="62" r=".8"/><circle cx="96" cy="64" r=".6"/></g>
    <circle cx="86" cy="40" r="15" fill="url(#pl${u})"/>
    <ellipse cx="86" cy="40" rx="25" ry="5" fill="none" stroke="#fde68a" stroke-width="1.6" opacity=".8" transform="rotate(-18 86 40)"/>
    <path class="s-shoot" d="M100 6 l8 -4" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>`,
  city: (u) => `
    <defs>${wGrad('ct' + u, [[0, '#1e1b4b'], [.7, '#7c2d12'], [1, '#f97316']])}</defs>
    <rect width="120" height="72" fill="url(#ct${u})"/>
    <circle cx="96" cy="16" r="7" fill="#fef3c7" opacity=".9"/>
    <path d="M0 50 h10 v-14 h8 v10 h10 v-20 h10 v24 h8 v-12 h12 v-18 h8 v30 h10 v-16 h10 v8 h12 v-10 h12 V72 H0 Z" fill="#0f172a"/>
    <g class="s-blink" fill="#fde047"><rect x="13" y="40" width="2" height="2"/><rect x="31" y="32" width="2" height="2"/><rect x="34" y="38" width="2" height="2"/><rect x="31" y="44" width="2" height="2"/><rect x="58" y="36" width="2" height="2"/><rect x="61" y="42" width="2" height="2"/><rect x="77" y="30" width="2" height="2"/><rect x="80" y="38" width="2" height="2"/><rect x="77" y="46" width="2" height="2"/><rect x="98" y="48" width="2" height="2"/><rect x="110" y="44" width="2" height="2"/></g>
    <path d="M0 60 H120 V72 H0 Z" fill="#020617"/><path class="s-drift" d="M0 64 h6" stroke="#ef4444" stroke-width="1.5"/><path class="s-drift-2" d="M0 67 h6" stroke="#fde68a" stroke-width="1.5"/>`,
  forest: (u) => `
    <defs>${wGrad('fo' + u, [[0, '#7dd3fc'], [1, '#e0f2fe']])}</defs>
    <rect width="120" height="72" fill="url(#fo${u})"/>
    <circle class="s-glow" cx="24" cy="16" r="8" fill="#fde68a"/>
    <path d="M0 44 Q30 30 60 42 T120 38 V72 H0 Z" fill="#4ade80" opacity=".6"/>
    <path d="M0 54 Q40 42 80 52 T120 50 V72 H0 Z" fill="#16a34a"/>
    ${[8, 22, 40, 58, 76, 96, 110].map((x, i) => `<path d="M${x} ${62 - (i % 3) * 3} l6 -18 l6 18 z" fill="#14532d"/>`).join('')}
    <path d="M0 66 H120 V72 H0 Z" fill="#14532d"/>
    <g class="s-flap" stroke="#1f2937" stroke-width="1" fill="none"><path d="M10 20 q2 -2 4 0 q2 -2 4 0"/><path d="M0 26 q1.5 -1.5 3 0 q1.5 -1.5 3 0"/></g>`,
  desert: (u) => `
    <defs>${wGrad('de' + u, [[0, '#7c3aed'], [.45, '#f472b6'], [.75, '#fb923c'], [1, '#fde68a']])}</defs>
    <rect width="120" height="72" fill="url(#de${u})"/>
    <circle class="s-glow" cx="60" cy="44" r="14" fill="#fde047" opacity=".9"/>
    <path class="s-wave" d="M0 46 Q30 40 60 46 T120 44 V72 H0 Z" fill="#c2410c" opacity=".7"/>
    <path d="M0 54 Q35 44 70 54 T120 52 V72 H0 Z" fill="#9a3412"/>
    <path d="M0 62 Q50 54 90 62 T120 60 V72 H0 Z" fill="#7c2d12"/>
    <path d="M96 52 v-12 M96 46 h-4 v-4 M96 44 h4 v-5" stroke="#3f1d0b" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  snow: (u) => `
    <defs>${wGrad('sn' + u, [[0, '#94a3b8'], [1, '#e2e8f0']])}</defs>
    <rect width="120" height="72" fill="url(#sn${u})"/>
    <path d="M0 52 L24 22 L40 40 L62 12 L88 44 L104 28 L120 46 V72 H0 Z" fill="#64748b"/>
    <path d="M24 22 L18 30 L24 28 L30 32 Z M62 12 L54 22 L62 19 L70 24 Z M104 28 L99 34 L104 32 L109 35 Z" fill="#f8fafc"/>
    <path d="M0 60 Q40 52 80 60 T120 58 V72 H0 Z" fill="#f1f5f9"/>
    <g class="s-fall" fill="#fff"><circle cx="10" cy="4" r="1"/><circle cx="30" cy="0" r=".8"/><circle cx="52" cy="6" r="1.1"/><circle cx="74" cy="2" r=".8"/><circle cx="94" cy="5" r="1"/><circle cx="112" cy="0" r=".9"/><circle cx="20" cy="18" r=".8"/><circle cx="84" cy="16" r="1"/></g>`,
  aurora: (u) => `
    <defs>${wGrad('au' + u, [[0, '#020617'], [1, '#0f2a3a']])}</defs>
    <rect width="120" height="72" fill="url(#au${u})"/>
    <g class="s-twinkle" fill="#fff"><circle cx="12" cy="8" r=".7"/><circle cx="40" cy="4" r=".6"/><circle cx="78" cy="10" r=".8"/><circle cx="108" cy="6" r=".6"/><circle cx="96" cy="30" r=".5"/></g>
    <path class="s-wave" d="M-6 30 C20 10 40 34 64 18 S100 14 126 26 L126 36 C100 26 84 34 64 30 S20 22 -6 42 Z" fill="#34d399" opacity=".55"/>
    <path class="s-wave s-wave-2" d="M-6 22 C24 6 48 26 72 12 S110 10 126 18 L126 24 C104 18 84 24 66 22 S22 18 -6 30 Z" fill="#a78bfa" opacity=".45"/>
    <path d="M0 60 L6 46 L12 60 Z M10 62 L18 42 L26 62 Z M30 62 L36 50 L42 62 Z M84 62 L92 44 L100 62 Z M100 62 L106 50 L112 62 Z M110 62 L116 48 L122 62 Z" fill="#020617"/>
    <path d="M0 62 H120 V72 H0 Z" fill="#0b1324"/>`,
  rain: (u) => `
    <defs>${wGrad('ra' + u, [[0, '#334155'], [1, '#64748b']])}</defs>
    <rect width="120" height="72" fill="url(#ra${u})"/>
    <path d="M0 52 h14 v-22 h12 v14 h10 v-26 h14 v30 h12 v-18 h14 v22 h12 v-14 h12 v10 h20 V72 H0 Z" fill="#1e293b" opacity=".85"/>
    <g fill="#94a3b8" opacity=".5"><rect x="17" y="34" width="2" height="2"/><rect x="40" y="24" width="2" height="2"/><rect x="66" y="30" width="2" height="2"/><rect x="92" y="40" width="2" height="2"/></g>
    <g class="s-rain" stroke="#cbd5e1" stroke-width=".7" opacity=".6">${Array.from({ length: 16 }, (_, i) => `<path d="M${(i * 8 + 3) % 124} ${(i * 13) % 50} l-2 7"/>`).join('')}</g>`,
  lava: (u) => `
    <defs>${wGrad('la' + u, [[0, '#1c1917'], [1, '#44403c']])}</defs>
    <rect width="120" height="72" fill="url(#la${u})"/>
    <path d="M0 0 H120 V10 L110 18 L100 8 L86 16 L70 6 L54 14 L40 4 L26 14 L12 6 L0 12 Z" fill="#0c0a09"/>
    <path d="M0 46 L18 40 L30 48 L50 38 L70 46 L92 36 L120 44 V56 H0 Z" fill="#292524"/>
    <path class="s-glow" d="M0 56 Q30 50 60 56 T120 54 V72 H0 Z" fill="#ea580c"/>
    <path class="s-wave" d="M0 60 Q20 56 40 60 T80 58 T120 61 V72 H0 Z" fill="#fde047" opacity=".7"/>
    <g class="s-rise" fill="#fb923c"><circle cx="30" cy="56" r="1"/><circle cx="74" cy="56" r=".8"/><circle cx="100" cy="55" r=".9"/></g>`,
  blossom: (u) => `
    <defs>${wGrad('bl' + u, [[0, '#bae6fd'], [1, '#fdf2f8']])}</defs>
    <rect width="120" height="72" fill="url(#bl${u})"/>
    <path d="M0 50 Q40 38 80 48 T120 44 V72 H0 Z" fill="#86efac"/>
    <path d="M0 60 Q50 52 120 58 V72 H0 Z" fill="#4ade80"/>
    <path d="M86 50 v-20 M86 38 l-8 -6 M86 34 l7 -7" stroke="#57361b" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <circle cx="80" cy="26" r="9" fill="#f9a8d4"/><circle cx="92" cy="24" r="8" fill="#fbcfe8"/><circle cx="86" cy="18" r="7" fill="#f472b6" opacity=".8"/>
    <g class="s-fall" fill="#f9a8d4"><circle cx="70" cy="28" r="1.1"/><circle cx="84" cy="30" r=".9"/><circle cx="96" cy="26" r="1"/><circle cx="60" cy="20" r=".8"/><circle cx="104" cy="22" r=".9"/></g>`,
};
const WINDOW_SCENE_KEYS = Object.keys(WINDOW_SCENES);
// what a robot looking out of the window sees
const WINDOW_EMOTE = {
  ocean: '🐟', space: '🌠', city: '🌃', forest: '🐦', desert: '🌅',
  snow: '❄️', aurora: '✨', rain: '☔', lava: '🔥', blossom: '🌸',
};

function windowSceneFor(key, seed) {
  const k = windowViews[key];
  return WINDOW_SCENES[k] ? k : WINDOW_SCENE_KEYS[seed % WINDOW_SCENE_KEYS.length];
}

// Right-click → Change view: any other scene, remembered for this room
function rerollWindowView(key, seed) {
  const cur = windowSceneFor(key, seed);
  const others = WINDOW_SCENE_KEYS.filter((k) => k !== cur);
  windowViews[key] = others[Math.floor(Math.random() * others.length)];
  window.electronAPI?.storeSet?.('windowViews', windowViews);
}

// The widest gap between the room's first furniture, right of the name plate.
// Remembered per room so the window doesn't jump when pieces come and go.
function windowSpotFor(key, furn, seed) {
  if (windowSpot.has(key)) return windowSpot.get(key);
  const xs = [...new Set(furn.map((p) => p.x))].sort((a, b) => a - b);
  const edges = [0, ...xs, 100];
  let best = null;
  for (let i = 0; i < edges.length - 1; i++) {
    const mid = (edges[i] + edges[i + 1]) / 2, w = edges[i + 1] - edges[i];
    if (mid < 42 || mid > 90) continue; // the name plate sits top-left
    // equal gaps: the room's seed picks, so rooms don't all line up
    if (!best || w > best.w + 0.5 || (Math.abs(w - best.w) <= 0.5 && ((seed >>> 3) & 1))) best = { mid, w };
  }
  const x = best ? best.mid : 62;
  windowSpot.set(key, x);
  return x;
}

function isNightNow() {
  const h = new Date().getHours();
  return h >= 19 || h < 6;
}

// The window for one room: frame + scene + a soft spill of its light on the wall
function buildVaultWindowHtml(key, seed, furn) {
  if (typeof vaultWindowsOn !== 'undefined' && !vaultWindowsOn) return '';
  const scene = windowSceneFor(key, seed);
  const frame = WINDOW_FRAMES[(seed >>> 7) % WINDOW_FRAMES.length];
  const x = windowSpotFor(key, furn, seed);
  // the room is redrawn often: start every animation where it would be by now, so
  // fish and snow carry on instead of jumping back to the start
  const t = -Math.round(performance.now());
  // data-kind/data-emote: idle robots walk over and look out of it (robots.js, IDLE_AT.window)
  return `<span class="vault-window vw-${frame} scene-${scene}${isNightNow() ? ' vw-night' : ''}" data-kind="window" data-emote="${WINDOW_EMOTE[scene] || '👀'}" style="left:${x}%;--vw-t:${t}ms">` +
    '<span class="vw-spill"></span>' +
    `<span class="vw-frame"><svg class="vw-scene" viewBox="0 0 120 72" preserveAspectRatio="xMidYMid slice">${WINDOW_SCENES[scene](++windowUid)}</svg><span class="vw-glare"></span></span>` +
    '</span>';
}
