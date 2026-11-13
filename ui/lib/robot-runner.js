// Side-view running robot for the activity card, wearing the same outfit as the
// contact picture (hats, glasses, clothes from robot-outfits.js), drawn in profile.
//
//   window.buildRunnerSvg(hue, outfit) → SVG text
//
// Robot colours are hue-shifted exactly like the avatar (shiftHexHue in app.js);
// outfit pieces keep their own colours. Limbs pivot at hip (20,31) / knee (20,37)
// / shoulder (20,22); the CSS in features.css animates the run cycle.
(function () {
  const P = { outline: '#1a2b57', main: '#62b6d8', light: '#80dcef', mid: '#57a3ce', dark: '#4479b0', white: '#f7f7f7' };

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
  }
  const okHex = (c, d) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : d);

  // ---- hats (head group, so they bob/nod with the head). Head spans x 8.5–33.8, top y -1.5 ----
  const HATS = {
    tophat: (c, o) => `
      <rect x="13.5" y="-14" width="15" height="13" rx="1.6" fill="${c}" stroke="${o}" stroke-width="1"/>
      <rect x="13.5" y="-4.6" width="15" height="2.6" fill="${shade(c, -0.45)}"/>
      <ellipse cx="21" cy="-1" rx="13.5" ry="2.3" fill="${shade(c, -0.15)}" stroke="${o}" stroke-width="1"/>`,
    cap: (c, o) => `
      <path d="M9.6,3.5C10.5,-4 16,-6 21.5,-6C27.5,-6 32.5,-3 33,3.5Z" fill="${c}" stroke="${o}" stroke-width="1"/>
      <path d="M30.5,1.6C34.5,1.2 39,2 40.5,3.4C37,4.4 33,4.4 30.5,3.8Z" fill="${shade(c, -0.25)}" stroke="${o}" stroke-width="1"/>
      <circle cx="21.5" cy="-6.2" r="1.1" fill="${shade(c, -0.3)}"/>`,
    beanie: (c, o) => `
      <path d="M8.9,4.5C8.9,-4.5 14,-7.5 21,-7.5C28,-7.5 33.4,-4.5 33.4,4.5Z" fill="${c}" stroke="${o}" stroke-width="1"/>
      <path d="M12,-3.5V3.5M15.5,-5.8V3.5M19,-6.8V3.5M22.5,-6.9V3.5M26,-6.2V3.5M29.5,-4.5V3.5" stroke="${shade(c, -0.2)}" stroke-width=".8"/>
      <rect x="8.4" y="1.6" width="25.5" height="4" rx="2" fill="${shade(c, -0.18)}" stroke="${o}" stroke-width="1"/>
      <circle cx="19" cy="-8.6" r="2.8" fill="${shade(c, 0.35)}" stroke="${o}" stroke-width="1"/>`,
    party: (c, o) => `
      <path d="M13,0.5L19.5,-17L28,0.5Z" fill="${c}" stroke="${o}" stroke-width="1" stroke-linejoin="round"/>
      <path d="M16.3,-7.5L22.4,-6.2M14.6,-3L25.7,-1.8" stroke="${shade(c, 0.55)}" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="19.5" cy="-17.5" r="2.2" fill="#f2c230" stroke="${o}" stroke-width=".8"/>`,
    crown: (c, o) => `
      <path d="M12,1L11,-8.5L15.8,-3.5L20.5,-10L25.2,-3.5L30,-8.5L29,1Z" fill="#f2c230" stroke="${o}" stroke-width="1" stroke-linejoin="round"/>
      <rect x="11.6" y="-1.6" width="17.8" height="2.8" fill="${shade('#f2c230', -0.18)}"/>
      <circle cx="20.5" cy="-3.2" r="1.6" fill="${c}"/><circle cx="14.2" cy="-1.8" r="1" fill="${c}"/><circle cx="26.8" cy="-1.8" r="1" fill="${c}"/>`,
    headphones: (c, o) => `
      <path d="M14.5,8C12.5,-1 16,-5.5 21,-5.5C26,-5.5 28.5,-2 27.5,3" fill="none" stroke="${shade(c, -0.25)}" stroke-width="2.4" stroke-linecap="round"/>
      <rect x="11.2" y="5.2" width="8" height="11" rx="3.5" fill="${c}" stroke="${o}" stroke-width="1"/>
      <rect x="13" y="7.3" width="4.4" height="6.8" rx="2.2" fill="${shade(c, 0.3)}"/>`,
    hardhat: (c, o) => `
      <path d="M9.4,4.6C10.2,-4.6 15.8,-7 21.3,-7C27.4,-7 32.6,-4 33.2,4.6Z" fill="${c}" stroke="${o}" stroke-width="1"/>
      <path d="M19.6,-7V4.2M23,-7V4.2" stroke="${shade(c, -0.22)}" stroke-width="1.2"/>
      <path d="M13,1.5C13.6,-2.5 16.2,-4.6 19,-5.2" stroke="#fff" stroke-opacity=".45" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <rect x="6.6" y="3.4" width="30.2" height="2.8" rx="1.4" fill="${shade(c, -0.14)}" stroke="${o}" stroke-width="1"/>`,
    cowboy: (c, o) => `
      <path d="M13.8,1.2L14.6,-8.8Q18,-10.2 21.2,-7.6Q24.4,-10.2 27.8,-8.8L28.6,1.2Z" fill="${c}" stroke="${o}" stroke-width="1" stroke-linejoin="round"/>
      <rect x="14" y="-2.4" width="14.4" height="2.4" fill="${shade(c, -0.4)}"/>
      <path d="M4.6,-0.6Q21,6.4 38,-1.4Q37.6,2.6 34,3.6Q21,7.6 8,3.6Q4.6,2.4 4.6,-0.6Z" fill="${shade(c, -0.12)}" stroke="${o}" stroke-width="1" stroke-linejoin="round"/>`,
    wizard: (c, o) => `
      <ellipse cx="21" cy="1" rx="13.6" ry="2.6" fill="${shade(c, -0.25)}" stroke="${o}" stroke-width="1"/>
      <path d="M13,0.6Q16.5,-11 26.5,-22Q24.5,-10 29.6,0.6Z" fill="${c}" stroke="${o}" stroke-width="1" stroke-linejoin="round"/>
      <path d="M19.4,-5.6l.9,1.8 2,.3-1.4,1.4.3,2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" fill="#f2c230"/>`,
    chef: (c, o) => `
      <circle cx="15.6" cy="-6.6" r="4.6" fill="#f7f7f7" stroke="${o}" stroke-width="1"/>
      <circle cx="26.6" cy="-6.6" r="4.6" fill="#f7f7f7" stroke="${o}" stroke-width="1"/>
      <circle cx="21.1" cy="-9.2" r="5.4" fill="#f7f7f7" stroke="${o}" stroke-width="1"/>
      <rect x="13.2" y="-5" width="15.8" height="6.8" rx="1.4" fill="#f7f7f7" stroke="${o}" stroke-width="1"/>
      <rect x="13.2" y="-0.2" width="15.8" height="1.8" fill="${c}"/>`,
    propeller: (c, o) => `
      <path d="M9.4,4.4C9.6,-4 15.2,-6.8 21.2,-6.8C27.2,-6.8 32.8,-4 33,4.4Z" fill="${c}" stroke="${o}" stroke-width="1"/>
      <path d="M21.2,-6.8L15,4.2H27.4Z" fill="#f2c230"/>
      <rect x="20.5" y="-11" width="1.4" height="4.4" fill="#3a3f4b"/>
      <ellipse cx="16.6" cy="-11.4" rx="4.8" ry="1.3" fill="#f2c230" stroke="${o}" stroke-width=".8"/>
      <ellipse cx="25.8" cy="-11.4" rx="4.8" ry="1.3" fill="#e0483e" stroke="${o}" stroke-width=".8"/>
      <circle cx="21.2" cy="-11.4" r="1.3" fill="#3a3f4b"/>`,
    bow: (c, o) => `
      <path d="M15,0.4C11,-6 6.6,-3 8,0.8C9,3.4 12.4,2.4 15,0.4Z" fill="${c}" stroke="${o}" stroke-width="1" stroke-linejoin="round"/>
      <path d="M15,0.4C19,-6 23.4,-3 22,0.8C21,3.4 17.6,2.4 15,0.4Z" fill="${c}" stroke="${o}" stroke-width="1" stroke-linejoin="round"/>
      <circle cx="15" cy="0.4" r="2" fill="${shade(c, -0.15)}" stroke="${o}" stroke-width=".9"/>`,
    halo: (c, o) => `
      <ellipse cx="21" cy="-6" rx="9" ry="2.2" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="3.4"/>
      <ellipse cx="21" cy="-6" rx="9" ry="2.2" fill="none" stroke="${o}" stroke-width="2.2"/>
      <ellipse cx="21" cy="-6" rx="9" ry="2.2" fill="none" stroke="${c}" stroke-width="1.2"/>`,
  };
  // these sit on top of the head; the others leave the ear bolt visible
  const HAT_HIDES_EAR = { headphones: true };

  // ---- glasses: one lens at the eye (28.2, 8.6) + an arm back to the ear ----
  const arm = (c) => `<path d="M24.2,8.6L15.8,9.8" stroke="${c}" stroke-width="1.2" stroke-linecap="round"/>`;
  const GLASSES = {
    round: (c) => `${arm(c)}<circle cx="28.6" cy="8.8" r="4.5" fill="rgba(255,255,255,.18)" stroke="${c}" stroke-width="1.2"/>`,
    shades: (c) => `${arm(c)}<path d="M24,6H33.4V9.5C33.4,12 31.5,12.6 28.8,12.6C25.8,12.6 24,11.8 24,9.5Z" fill="${shade(c, -0.55)}" stroke="${c}" stroke-width="1"/>
      <path d="M25.5,7.4L27.6,7.4" stroke="#fff" stroke-width=".8" opacity=".55" stroke-linecap="round"/>`,
    nerd: (c) => `${arm(c)}<rect x="23.8" y="4.4" width="9.6" height="8.6" rx="2.2" fill="rgba(255,255,255,.12)" stroke="${c}" stroke-width="1.8"/>`,
    hearts: (c) => `${arm(c)}<path d="M28.6,13.4C24,10.4 23.4,7.6 24.6,5.8C25.8,4 28,4.4 28.6,6.2C29.2,4.4 31.4,4 32.6,5.8C33.8,7.6 33.2,10.4 28.6,13.4Z" fill="${c}" opacity=".88" stroke="${shade(c, -0.35)}" stroke-width=".8"/>`,
    monocle: (c) => `<circle cx="28.6" cy="8.8" r="4.3" fill="rgba(255,255,255,.18)" stroke="${c}" stroke-width="1.3"/>
      <path d="M26,12.8C24.5,16 25.5,18.5 23,20.5" fill="none" stroke="${c}" stroke-width=".7"/>`,
  };

  // ---- clothes: over the torso (x 13–27, y 19.5–32); sleeves recolour the upper arms ----
  const torso = (c, o) => `<rect x="13" y="19.5" width="14" height="12.5" rx="4" fill="${c}" stroke="${o}" stroke-width="1"/>`;
  const CLOTHES = {
    shirt: (c, o) => `${torso(c, o)}<path d="M23,19.8L25.2,22.6L26.8,20.2" fill="none" stroke="${shade(c, -0.35)}" stroke-width=".9"/>`,
    hoodie: (c, o) => `<ellipse cx="13.6" cy="20.6" rx="4" ry="3.2" fill="${shade(c, -0.15)}" stroke="${o}" stroke-width="1"/>${torso(c, o)}
      <path d="M16.5,27.2H25" stroke="${shade(c, -0.3)}" stroke-width=".9"/><path d="M24.2,20.2V24.6M25.6,20.2V24" stroke="#fff" stroke-width=".6" opacity=".8"/>`,
    suit: (c, o) => `${torso(c, o)}<path d="M23.3,19.7H27V27.5L25.2,22.8Z" fill="#fff"/><path d="M24.6,21L25.8,21L26.4,27.5L25.2,28.8L24,27.5Z" fill="${shade(c, -0.45)}"/>
      <circle cx="21" cy="29.4" r=".7" fill="${shade(c, -0.45)}"/>`,
    sweater: (c, o) => `${torso(c, o)}<path d="M13.3,23.3H26.7M13,26.6H27M13.3,29.9H26.7" stroke="#fff" stroke-width="1.3" opacity=".9"/>`,
    overalls: (c, o) => `<path d="M13,25.5H27V28A4,4 0 0 1 23,32H17A4,4 0 0 1 13,28Z" fill="${c}" stroke="${o}" stroke-width="1"/>
      <rect x="21.5" y="19.8" width="2.8" height="6" fill="${c}" stroke="${o}" stroke-width=".8"/><circle cx="22.9" cy="25.4" r=".8" fill="#f2f4f7"/>`,
    scarf: (c, o) => `<path class="r-scarf-tail" d="M14.5,19.6C10,20 6.5,22.5 3,21.5C5.5,24 10,23.6 14.5,22.3Z" fill="${shade(c, -0.1)}" stroke="${o}" stroke-width=".9"/>
      <rect x="12.3" y="17.6" width="16" height="4" rx="2" fill="${c}" stroke="${o}" stroke-width="1"/>
      <path d="M15.5,17.8V21.4M19.5,17.8V21.4M23.5,17.8V21.4" stroke="${shade(c, 0.35)}" stroke-width=".7"/>`,
  };
  const SLEEVES = { shirt: 1, hoodie: 1, suit: 1, sweater: 1 };

  // ---- props per activity (see docs/design/agent-stage.html). `arm` goes inside the
  // front arm so it moves with the hand; `body` sits beside the robot. ----
  const PROPS = {
    type: { body: `
      <rect x="27" y="31" width="16" height="2" rx="1" fill="#8a5a3c" stroke="#3b2618" stroke-width=".6"/>
      <rect x="29" y="33" width="1.6" height="12" fill="#6b4630"/><rect x="40" y="33" width="1.6" height="12" fill="#6b4630"/>
      <path d="M29,31L42,31L42,30.2L29,30.2Z" fill="#c9d2dd"/>
      <path d="M33,30.2L36.2,21.5L44,21.5L41,30.2Z" fill="#2b2f3a" stroke="#14171c" stroke-width=".6"/>
      <path class="rp-glow" d="M34.2,29.3L36.9,22.4L42.8,22.4L40.2,29.3Z" fill="#5bc0ff"/>
      <g fill="#fff"><rect class="rp-code" x="37.6" y="23.6" width="3.6" height=".7"/><rect class="rp-code" x="37" y="25.3" width="2.8" height=".7"/><rect class="rp-code" x="36.4" y="27" width="3.4" height=".7"/></g>` },
    read: { arm: `
      <g transform="translate(23.2,27.5) rotate(92)"><rect x="-1" y="-4.6" width="9.5" height="9" rx="1" fill="#c0392b" stroke="#6b1d16" stroke-width=".6"/>
      <rect x="-.2" y="-3.8" width="4" height="7.4" fill="#fffaf0"/><rect class="rp-page" x="3.8" y="-3.8" width="4" height="7.4" fill="#f2ead8"/></g>` },
    search: { arm: `
      <g transform="translate(23.5,28)"><path d="M0,0L3,4" stroke="#6b4630" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="5" cy="7" r="3.6" fill="rgba(160,220,255,.35)" stroke="#c9a227" stroke-width="1.3"/>
      <path class="rp-glint" d="M3.4,5.4A2.4,2.4 0 0 1 5.6,4.4" stroke="#fff" stroke-width=".8" fill="none"/></g>` },
    hammer: { arm: `
      <g transform="translate(23.6,28.4) rotate(-15)"><rect x="-.7" y="-1" width="1.5" height="9" rx=".6" fill="#8a5a3c"/>
      <rect x="-3" y="7" width="6.5" height="3.6" rx=".8" fill="#9aa4b1" stroke="#4a5260" stroke-width=".6"/></g>`,
      body: `
      <rect x="30" y="38" width="11" height="7" rx="1" fill="#14171c" stroke="#3a414c" stroke-width=".7"/>
      <path d="M31.6,40.4L33.2,41.6L31.6,42.8M34,42.8H36.6" stroke="#4fd06a" stroke-width=".8" fill="none"/>
      <g class="rp-spark"><path d="M33,37L30,33M33,37L34.5,32.5M33,37L37,34M33,37L29,36" stroke="#ffd34a" stroke-width=".9" stroke-linecap="round"/></g>` },
    web: { body: `
      <circle cx="37" cy="6" r="4.6" fill="#2f6fd6" stroke="#1a3f80" stroke-width=".8"/>
      <g class="rp-globe"><ellipse cx="37" cy="6" rx="2" ry="4.6" fill="none" stroke="#9fe0ff" stroke-width=".7"/>
      <path d="M32.4,6H41.6M33.2,3.5H40.8M33.2,8.5H40.8" stroke="#9fe0ff" stroke-width=".6"/></g>
      <path d="M34.6,3.1A3.2,3.2 0 0 1 37.4,2.2" stroke="#fff" stroke-width=".8" fill="none" opacity=".7"/>` },
  };

  // pose: run | think | type | read | search | hammer | web (CSS: .pose-<name> in features.css)
  window.buildRunnerSvg = function (hue, outfit, pose) {
    const prop = PROPS[pose] || {};
    const sh = (hex) => (hue && typeof shiftHexHue === 'function' ? shiftHexHue(hex, hue) : hex);
    const o = sh(P.outline), main = sh(P.main), light = sh(P.light), mid = sh(P.mid), dark = sh(P.dark), white = P.white;
    const fit = outfit || {};
    const hatC = okHex(fit.hatColor, '#e0483e'), glC = okHex(fit.glassesColor, '#3a3f4b'), clC = okHex(fit.clothesColor, '#3faa4a');
    const sleeve = fit.clothes && SLEEVES[fit.clothes];
    const armFront = sleeve ? clC : mid, armBack = sleeve ? shade(clC, -0.25) : dark;

    // Limbs: the whole limb's OUTLINE is drawn first, then the fills on top, so
    // elbows and knees show one smooth silhouette instead of a seam where the
    // pieces overlap. (Moving parts are repeated in both layers; same classes →
    // same animation, so they stay together.)
    const line = (shape) => shape.replace('/>', ` fill="${o}" stroke="${o}" stroke-width="2" stroke-linejoin="round"/>`);
    const fillOf = (shape, c) => shape.replace('/>', ` fill="${c}"/>`);
    const UPPER = '<rect x="18.5" y="21" width="3" height="7" rx="1.5"/>';
    const FORE = '<rect class="r-fore" x="18.5" y="26" width="3" height="6" rx="1.5"/>';
    const limb = (cls, upper, lower, fill, held = '') =>
      `<g class="${cls}">${line(UPPER)}${line(FORE)}${fillOf(UPPER, upper)}${fillOf(FORE, fill)}${held}</g>`;
    const THIGH = '<rect x="18" y="30" width="4" height="8" rx="2"/>';
    const SHIN = '<rect x="18" y="36" width="4" height="8" rx="2"/>';
    const FOOT = '<rect x="17" y="42" width="7.5" height="3" rx="1.5"/>';
    const leg = (cls, fill) =>
      `<g class="${cls}">${line(THIGH)}<g class="r-shin">${line(SHIN)}${line(FOOT)}</g>` +
      `${fillOf(THIGH, fill)}<g class="r-shin">${fillOf(SHIN, fill)}${fillOf(FOOT, fill)}</g></g>`;
    const legBackFill = fit.clothes === 'overalls' ? shade(clC, -0.25) : dark;
    const legFrontFill = fit.clothes === 'overalls' ? clC : mid;

    const hat = fit.hat && HATS[fit.hat] ? HATS[fit.hat](hatC, o) : '';
    const glasses = fit.glasses && GLASSES[fit.glasses] ? GLASSES[fit.glasses](glC) : '';
    const clothes = fit.clothes && CLOTHES[fit.clothes] ? CLOTHES[fit.clothes](clC, o) : '';
    const ear = HAT_HIDES_EAR[fit.hat] ? '' : `<circle cx="15.2" cy="10.6" r="2.6" fill="${mid}" stroke="${o}" stroke-width="1"/>`;

    return `<svg viewBox="0 -5 40 52" class="runner" aria-hidden="true" overflow="visible">
  <g class="r-body">
    ${limb('r-arm r-arm-back', armBack, dark, dark)}
    ${leg('r-leg r-leg-back', legBackFill)}
    <rect class="r-torso" x="13" y="19.5" width="14" height="12.5" rx="4" fill="${main}" stroke="${o}" stroke-width="1"/>
    <circle cx="22.5" cy="25.5" r="1.8" fill="${white}" opacity=".85"/>
    ${clothes}
    <g class="r-head">
      <path d="M8.5,10.5C8.5,3.5 13.5,-1.5 21,-1.5C28.8,-1.5 33.8,3.8 33.8,10.2C33.8,16.6 28.8,20.5 21,20.5C13.2,20.5 8.5,17 8.5,10.5Z" fill="${main}" stroke="${o}" stroke-width="1.4"/>
      <path d="M12.5,6.5C13.5,2.8 17,0.8 20.5,0.8C18,2.2 15.5,4.5 14.6,7.6Z" fill="${light}" opacity=".9"/>
      <ellipse cx="14" cy="15.5" rx="4.5" ry="3" fill="${dark}" opacity=".35"/>
      ${ear}
      <g class="r-eye">
        <ellipse cx="28.2" cy="8.6" rx="3.3" ry="4.2" fill="${white}" stroke="${o}" stroke-width="1"/>
        <ellipse cx="29.6" cy="9.1" rx="1.9" ry="2.8" fill="${o}"/>
        <circle cx="30.2" cy="7.9" r="0.8" fill="#fff"/>
      </g>
      <path d="M29.2,15.2Q31.2,16.6 32.9,14.8" fill="none" stroke="${o}" stroke-width="1.1" stroke-linecap="round"/>
      ${glasses}
      ${hat}
    </g>
    ${leg('r-leg r-leg-front', legFrontFill)}
    ${limb('r-arm r-arm-front', armFront, mid, mid, prop.arm)}
    ${prop.body ? `<g class="r-prop-body">${prop.body}</g>` : ''}
  </g>
</svg>`;
  };
})();
