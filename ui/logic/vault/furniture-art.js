// Vault view: more furniture. Loaded after rooms.js (AI_FURNITURE = the original looks).
//   AI_FURNITURE_ALT — a second look for each task piece (same job, same animated parts),
//                      picked per room so rooms don't all look alike
//   AI_DECOR         — pieces with no task: idle robots use them (coffee, books, arcade…)
// Every piece is drawn in a 64×56 box standing on y≈52, with a soft shadow at y=51.
// Animated parts reuse the f-* classes in features.css (they come alive while in use).
// Design sheet: docs/design/furniture.html

const AI_FURNITURE_ALT = {
  // Standing desk with one ultrawide curved screen
  diffDesk:
    '<g>' +
    '<rect x="8" y="51" width="48" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="14" y="30" width="3" height="22" fill="#334155"/><rect x="47" y="30" width="3" height="22" fill="#334155"/>' +
    '<rect x="11" y="50" width="9" height="2" rx="1" fill="#475569"/><rect x="44" y="50" width="9" height="2" rx="1" fill="#475569"/>' +
    '<rect x="8" y="28" width="48" height="3" rx="1" fill="#64748b"/><rect x="8" y="28" width="48" height="1" fill="#94a3b8"/>' +
    '<rect x="30" y="21" width="4" height="7" fill="#475569"/>' +
    '<path d="M9 7 Q32 3.5 55 7 L55 23 Q32 19.5 9 23 Z" fill="#0f172a" stroke="#475569" stroke-width="1.2"/>' +
    '<path class="f-screen" d="M11.5 9.3 Q32 6.2 52.5 9.3 L52.5 20.8 Q32 17.8 11.5 20.8 Z" fill="#082f49"/>' +
    '<g class="f-code"><path d="M15 12 h12 M15 15 h17" stroke="#34d399" stroke-width="1.3"/><path d="M15 18 h9" stroke="#fbbf24" stroke-width="1.3"/></g>' +
    '<g class="f-code f-code-2"><path d="M36 11 h12 M36 14 h8 M36 17 h12" stroke="#38bdf8" stroke-width="1.3"/></g>' +
    '<rect x="22" y="26.3" width="19" height="1.8" rx=".8" fill="#cbd5e1"/><ellipse cx="45.5" cy="27.2" rx="1.7" ry="1" fill="#e2e8f0"/>' +
    '</g>',
  // Two short liquid-cooled cabinets joined by coolant pipes
  gpuRack:
    '<g>' +
    '<rect x="8" y="51" width="48" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="10" y="19" width="16" height="3" rx="1" fill="#475569"/><rect x="38" y="19" width="16" height="3" rx="1" fill="#475569"/>' +
    '<rect x="8" y="22" width="20" height="30" rx="2" fill="#1e293b" stroke="#64748b" stroke-width="1.1"/>' +
    '<rect x="36" y="22" width="20" height="30" rx="2" fill="#1e293b" stroke="#64748b" stroke-width="1.1"/>' +
    '<circle class="f-led" cx="13" cy="26.5" r="1.3" fill="#22d3ee"/><circle class="f-led" cx="17" cy="26.5" r="1.3" fill="#10b981"/><path d="M20 26.5 h5" stroke="#475569" stroke-width="1.1"/>' +
    '<circle class="f-led" cx="41" cy="26.5" r="1.3" fill="#f59e0b"/><circle class="f-led" cx="45" cy="26.5" r="1.3" fill="#22d3ee"/><path d="M48 26.5 h5" stroke="#475569" stroke-width="1.1"/>' +
    '<rect x="11" y="31" width="14" height="17" rx="1.5" fill="#062a3a"/><rect class="f-fluid" x="13" y="36" width="10" height="11" rx="1" fill="#22d3ee" opacity=".5"/>' +
    '<rect x="39" y="31" width="14" height="17" rx="1.5" fill="#062a3a"/><rect class="f-fluid f-fluid-2" x="41" y="34" width="10" height="13" rx="1" fill="#38bdf8" opacity=".5"/>' +
    '<path d="M28 30 C32 25.5 32 25.5 36 30" fill="none" stroke="#38bdf8" stroke-width="2.4"/>' +
    '<path d="M28 45 C32 49.5 32 49.5 36 45" fill="none" stroke="#0e7490" stroke-width="2.4"/>' +
    '</g>',
  // Low console projecting a holographic screen
  promptTerm:
    '<g>' +
    '<rect x="12" y="51" width="40" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M26 37 L18 10 H46 L38 37 Z" fill="#22d3ee" opacity=".1"/>' +
    '<rect x="18" y="9" width="28" height="17" rx="1.5" fill="rgba(34,211,238,.12)" stroke="#22d3ee" stroke-width=".8"/>' +
    '<path class="f-term" d="M21 14 l3 2 l-3 2 M26 18 h11 M21 22 h17" fill="none" stroke="#67e8f9" stroke-width="1.4" stroke-linecap="round"/><rect class="f-cursor" x="39" y="21" width="2.6" height="2" fill="#67e8f9"/>' +
    '<path d="M14 52 L18 39 H46 L50 52 Z" fill="#334155" stroke="#64748b" stroke-width="1.1"/>' +
    '<rect x="17" y="37" width="30" height="3" rx="1" fill="#475569"/>' +
    '<ellipse cx="32" cy="37" rx="6" ry="1.4" fill="#22d3ee" opacity=".85"/>' +
    '<path d="M20 44 h6 M29 44 h6 M38 44 h6" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>' +
    '</g>',
  // Cork kanban board with sticky notes; an arrow moves a card along
  whiteboard:
    '<g>' +
    '<rect x="10" y="51" width="44" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M16 39 v13 M48 39 v13 M12 50 h8 M44 50 h8" stroke="#64748b" stroke-width="1.8" stroke-linecap="round"/>' +
    '<rect x="8" y="10" width="48" height="30" rx="2" fill="#3a2a17" stroke="#a16207" stroke-width="1.3"/>' +
    '<path d="M24 13 v24 M40 13 v24" stroke="#78350f" stroke-width="1" opacity=".7"/>' +
    '<rect x="11" y="13" width="10" height="7" rx=".6" fill="#fde047"/><rect x="11" y="22" width="10" height="7" rx=".6" fill="#f9a8d4"/>' +
    '<rect x="27" y="13" width="10" height="7" rx=".6" fill="#86efac"/><rect x="27" y="22" width="10" height="7" rx=".6" fill="#fde047"/>' +
    '<rect x="43" y="13" width="10" height="7" rx=".6" fill="#93c5fd"/>' +
    '<path d="M13 16 h6 M13 25 h5 M29 16 h6 M29 25 h4 M45 16 h6" stroke="rgba(0,0,0,.35)" stroke-width=".9"/>' +
    '<path class="f-draw" d="M16 33 C24 37 34 37 46 31 M43 30.5 l3 .5 l-1.5 2.6" fill="none" stroke="#f8fafc" stroke-width="1.1" stroke-linecap="round"/>' +
    '<rect x="12" y="38" width="40" height="2.5" rx="1" fill="#57361b"/>' +
    '</g>',
  // A glowing embedding orb in an orbit ring
  vectorPods:
    '<g>' +
    '<rect x="12" y="51" width="40" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M16 26 A16 5 0 0 1 48 26" fill="none" stroke="#34d399" stroke-width="1.1" opacity=".6"/>' +
    '<circle cx="32" cy="24" r="10.5" fill="#06281e" stroke="#34d399" stroke-width="1.1"/>' +
    '<circle class="f-fluid" cx="32" cy="25.5" r="7.5" fill="#10b981" opacity=".55"/>' +
    '<circle cx="29" cy="21" r="2.4" fill="#d1fae5" opacity=".35"/>' +
    '<g class="f-bubbles" fill="#a7f3d0"><circle cx="28" cy="29" r=".9"/><circle cx="33" cy="30" r=".8"/><circle cx="36" cy="27" r=".7"/></g>' +
    '<path d="M16 26 A16 5 0 0 0 48 26" fill="none" stroke="#6ee7b7" stroke-width="1.3"/>' +
    '<path d="M22 52 L26 38 H38 L42 52 Z" fill="#1e293b" stroke="#475569" stroke-width="1"/>' +
    '<rect x="25" y="36" width="14" height="3" rx="1" fill="#475569"/>' +
    '</g>',
  // Patch bay: two panels of ports with cables looping between them
  mcpDock:
    '<g>' +
    '<rect x="10" y="51" width="44" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="12" y="12" width="40" height="40" rx="2" fill="#1e1b36" stroke="#8b5cf6" stroke-width="1.2"/>' +
    '<rect x="15" y="15" width="34" height="7" rx="1" fill="#2e1065"/><rect x="15" y="26" width="34" height="7" rx="1" fill="#2e1065"/>' +
    '<g fill="#0b0820"><circle cx="19" cy="18.5" r="1.2"/><circle cx="24" cy="18.5" r="1.2"/><circle cx="34" cy="18.5" r="1.2"/><circle cx="44" cy="18.5" r="1.2"/>' +
    '<circle cx="19" cy="29.5" r="1.2"/><circle cx="29" cy="29.5" r="1.2"/><circle cx="34" cy="29.5" r="1.2"/><circle cx="44" cy="29.5" r="1.2"/></g>' +
    '<circle class="f-led" cx="29" cy="18.5" r="1.3" fill="#22d3ee"/><circle class="f-led" cx="39" cy="18.5" r="1.3" fill="#a78bfa"/><circle class="f-led" cx="24" cy="29.5" r="1.3" fill="#34d399"/><circle class="f-led" cx="39" cy="29.5" r="1.3" fill="#a78bfa"/>' +
    '<path class="f-cable" d="M19 20 C19 40 29 40 29 31" fill="none" stroke="#7c3aed" stroke-width="1.6"/>' +
    '<path class="f-cable" d="M34 20 C34 44 44 44 44 31" fill="none" stroke="#22d3ee" stroke-width="1.6"/>' +
    '<path d="M16 45 h32 M16 48 h32" stroke="#3b2a6b" stroke-width="1.2"/>' +
    '</g>',
  // Compile press: a hydraulic press squeezing a glowing block
  forgeCore:
    '<g>' +
    '<rect x="6" y="51" width="50" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="10" y="12" width="5" height="34" fill="#3f2d1d"/><rect x="37" y="12" width="5" height="34" fill="#3f2d1d"/>' +
    '<rect x="8" y="8" width="36" height="6" rx="1" fill="#57401f" stroke="#b45309" stroke-width="1"/>' +
    '<rect x="22" y="14" width="8" height="10" fill="#78716c"/><rect x="17" y="24" width="18" height="4" rx=".8" fill="#a8a29e"/>' +
    '<rect class="f-fire" x="19" y="33" width="14" height="7" rx="1" fill="#ea580c" opacity=".7"/><rect x="22" y="35" width="8" height="3" fill="#fde047" opacity=".9"/>' +
    '<rect x="14" y="40" width="24" height="4" fill="#44403c"/>' +
    '<rect x="8" y="44" width="36" height="8" rx="1" fill="#292524" stroke="#b45309" stroke-width="1"/>' +
    '<path d="M42 30 h5" stroke="#78716c" stroke-width="2"/><circle cx="52" cy="30" r="5" fill="#1c1917" stroke="#b45309" stroke-width="1"/><path d="M52 30 l3 -2" stroke="#f59e0b" stroke-width="1.1"/>' +
    '<circle class="f-led" cx="52" cy="41" r="1.4" fill="#f59e0b"/>' +
    '</g>',
  // Bean bag and a floor lamp (the seat is on the left, like the sofa)
  rechargePod:
    '<g>' +
    '<rect x="6" y="51" width="52" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<circle cx="50" cy="19" r="10" fill="#fde68a" opacity=".12"/>' +
    '<path d="M10 52 C7 41 13 33 24 33 C35 33 39 42 37 52 Z" fill="#0e7490" stroke="#155e75" stroke-width="1"/>' +
    '<path d="M15 41 C19 37.5 28 37.5 32 41" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.2"/>' +
    '<path d="M13 47 C18 45 29 45 34 47" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>' +
    '<rect x="49" y="16" width="2" height="35" fill="#94a3b8"/><ellipse cx="50" cy="51.5" rx="5" ry="1.4" fill="#64748b"/>' +
    '<path d="M43 16 L57 16 L54 9 L46 9 Z" fill="#fbbf24" stroke="#d97706" stroke-width=".8"/>' +
    '<rect x="39" y="45" width="7" height="7" rx="1" fill="#475569"/><rect x="40.5" y="41.5" width="3.5" height="3.5" rx=".6" fill="#e2e8f0"/>' +
    '</g>',
  // Archive cabinet: drawers of context with status lights
  ctxTank:
    '<g>' +
    '<rect x="14" y="51" width="36" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="16" y="12" width="32" height="40" rx="2" fill="#1f2937" stroke="#64748b" stroke-width="1.2"/>' +
    '<rect x="19" y="15" width="26" height="10" rx="1" fill="#273244"/><rect x="19" y="27" width="26" height="10" rx="1" fill="#273244"/><rect x="19" y="39" width="26" height="10" rx="1" fill="#273244"/>' +
    '<rect x="21" y="17" width="6" height="3" fill="#e5e7eb" opacity=".8"/><rect x="21" y="29" width="6" height="3" fill="#e5e7eb" opacity=".8"/><rect x="21" y="41" width="6" height="3" fill="#e5e7eb" opacity=".8"/>' +
    '<rect x="29" y="19" width="7" height="1.6" rx=".8" fill="#94a3b8"/><rect x="29" y="31" width="7" height="1.6" rx=".8" fill="#94a3b8"/><rect x="29" y="43" width="7" height="1.6" rx=".8" fill="#94a3b8"/>' +
    '<circle class="f-led" cx="41" cy="20" r="1.3" fill="#22d3ee"/><circle class="f-led" cx="41" cy="32" r="1.3" fill="#22d3ee"/><circle class="f-led" cx="41" cy="44" r="1.3" fill="#06b6d4"/>' +
    '<g class="f-bubbles" fill="#a5f3fc"><circle cx="26" cy="13" r="1"/><circle cx="32" cy="12" r=".8"/><circle cx="38" cy="13" r=".9"/></g>' +
    '</g>',
};

const AI_DECOR = {
  // Espresso machine on a counter; steam rises while someone's there
  coffeeBar:
    '<g>' +
    '<rect x="6" y="51" width="52" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="8" y="34" width="48" height="18" rx="1.5" fill="#3f3f46" stroke="#71717a" stroke-width="1"/>' +
    '<rect x="6" y="32" width="52" height="3" rx="1" fill="#a1a1aa"/>' +
    '<path d="M12 40 h40 M12 46 h40" stroke="#52525b" stroke-width="1"/>' +
    '<rect x="13" y="15" width="19" height="17" rx="2" fill="#52525b" stroke="#a1a1aa" stroke-width="1"/>' +
    '<rect x="18" y="23" width="9" height="3" fill="#27272a"/><rect x="19.5" y="27.5" width="6" height="4.5" rx="1" fill="#f5f5f4"/>' +
    '<circle class="f-led" cx="16" cy="18.5" r="1.2" fill="#22c55e"/><circle cx="27.5" cy="19" r="2.3" fill="#18181b" stroke="#d4d4d8" stroke-width=".8"/>' +
    '<g class="f-bubbles" fill="#e5e7eb"><circle cx="21.5" cy="26" r="1"/><circle cx="23.5" cy="26.5" r=".8"/><circle cx="22.5" cy="25.5" r=".7"/></g>' +
    '<rect x="37" y="26" width="5" height="6" rx="1" fill="#f5f5f4"/><rect x="43.5" y="27" width="5" height="5" rx="1" fill="#fca5a5"/>' +
    '<rect x="50" y="21" width="5" height="11" rx="1" fill="#78350f" opacity=".85"/><rect x="49.5" y="20" width="6" height="2" rx=".8" fill="#a1a1aa"/>' +
    '</g>',
  // Bookshelf, three shelves of books and a little globe
  bookshelf:
    '<g>' +
    '<rect x="10" y="51" width="44" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="12" y="8" width="40" height="44" rx="1.5" fill="#3b2a1a" stroke="#78350f" stroke-width="1.2"/>' +
    '<rect x="14" y="20" width="36" height="2" fill="#57361b"/><rect x="14" y="33" width="36" height="2" fill="#57361b"/><rect x="14" y="46" width="36" height="2" fill="#57361b"/>' +
    '<rect x="15" y="11" width="3" height="9" fill="#ef4444"/><rect x="18.5" y="10" width="2.5" height="10" fill="#3b82f6"/><rect x="21.5" y="12" width="3" height="8" fill="#22c55e"/><rect x="25" y="11" width="2" height="9" fill="#eab308"/>' +
    '<path d="M28 20 L31.5 12 L33.5 12.8 L30 20 Z" fill="#a855f7"/><rect x="36" y="11" width="3" height="9" fill="#f97316"/><rect x="39.5" y="13" width="4" height="7" fill="#14b8a6"/><rect x="44" y="10" width="2.5" height="10" fill="#e11d48"/>' +
    '<rect x="15" y="25" width="4" height="8" fill="#0ea5e9"/><rect x="19.5" y="24" width="2.5" height="9" fill="#f59e0b"/><rect x="22.5" y="26" width="3" height="7" fill="#64748b"/>' +
    '<circle cx="34" cy="28.5" r="4" fill="#0e7490" stroke="#fbbf24" stroke-width=".8"/><path d="M31 27 q3 2 6 0" stroke="#22c55e" stroke-width="1" fill="none"/><rect x="33" y="32.5" width="2" height="1" fill="#fbbf24"/>' +
    '<rect x="41" y="25" width="3" height="8" fill="#84cc16"/><rect x="44.5" y="24" width="3" height="9" fill="#ef4444"/>' +
    '<rect x="15" y="38" width="12" height="3" fill="#cbd5e1"/><rect x="15" y="41" width="12" height="3" fill="#94a3b8"/><rect x="15" y="44" width="12" height="2" fill="#e2e8f0"/>' +
    '<rect x="30" y="37" width="3" height="9" fill="#6366f1"/><rect x="33.5" y="38" width="3" height="8" fill="#10b981"/><rect x="37" y="37" width="2.5" height="9" fill="#f43f5e"/><rect x="40" y="39" width="4" height="7" fill="#f59e0b"/>' +
    '</g>',
  // Arcade cabinet; the game plays while someone's at it
  arcade:
    '<g>' +
    '<rect x="16" y="51" width="32" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M20 52 V11 L24 6 H44 V52 Z" fill="#1e1b4b" stroke="#6366f1" stroke-width="1.2"/>' +
    '<rect x="22" y="8" width="20" height="4" rx=".8" fill="#f472b6"/><path d="M26 10 h12" stroke="#fdf2f8" stroke-width="1" stroke-dasharray="2 1.2"/>' +
    '<rect x="22" y="14" width="20" height="15" rx="1" fill="#0f172a"/>' +
    '<rect class="f-screen" x="24" y="16" width="16" height="11" fill="#1e1b4b"/>' +
    '<g class="f-code"><rect x="26.5" y="18" width="2" height="2" fill="#34d399"/><rect x="31" y="18" width="2" height="2" fill="#34d399"/><rect x="35.5" y="18" width="2" height="2" fill="#34d399"/><rect x="28.5" y="21" width="2" height="2" fill="#a78bfa"/><rect x="33" y="21" width="2" height="2" fill="#a78bfa"/></g>' +
    '<rect x="30.8" y="24.5" width="2.4" height="1.6" fill="#fbbf24"/>' +
    '<path d="M20 30 H44 L46 36 H20 Z" fill="#312e81"/>' +
    '<path d="M26 34 v-2.5" stroke="#cbd5e1" stroke-width="1"/><circle cx="26" cy="31" r="1.4" fill="#ef4444"/>' +
    '<circle cx="35" cy="33" r="1.2" fill="#22d3ee"/><circle cx="39" cy="33" r="1.2" fill="#facc15"/>' +
    '<rect class="f-led" x="30" y="42" width="4" height="3" rx=".5" fill="#f59e0b"/>' +
    '</g>',
  // Planter with leafy plants under a grow light
  plantWall:
    '<g>' +
    '<rect x="6" y="51" width="52" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M12 9 L8 40 H56 L52 9 Z" fill="#f0abfc" opacity=".06"/>' +
    '<rect x="8" y="6" width="48" height="3" rx="1" fill="#475569"/><rect class="f-led" x="10" y="9" width="44" height="1.4" rx=".7" fill="#f0abfc"/>' +
    '<ellipse cx="18" cy="29" rx="6" ry="11" fill="#15803d"/><ellipse cx="15.5" cy="23" rx="3" ry="6" fill="#22c55e"/><path d="M18 40 V22" stroke="#14532d" stroke-width="1"/>' +
    '<circle cx="32" cy="30" r="9" fill="#16a34a"/><path d="M32 39 V24 M32 30 l-5 -4 M32 33 l5 -4" stroke="#14532d" stroke-width="1" fill="none"/><circle cx="29" cy="26" r="3" fill="#22c55e" opacity=".8"/>' +
    '<ellipse cx="46" cy="32" rx="7" ry="8" fill="#22c55e"/><ellipse cx="48" cy="28" rx="3.5" ry="5" fill="#4ade80"/><circle cx="43" cy="30" r="1.3" fill="#f472b6"/><circle cx="49" cy="34" r="1.3" fill="#fde047"/>' +
    '<rect x="10" y="40" width="44" height="12" rx="2" fill="#7c2d12" stroke="#9a3412" stroke-width="1"/><path d="M12 44 h40" stroke="#9a3412" stroke-width="1"/>' +
    '</g>',
  // Bunk bed (sit on the lower bunk, like the sofa); the top bunk is someone's
  bunk:
    '<g>' +
    '<rect x="6" y="51" width="52" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="8" y="10" width="3" height="42" fill="#64748b"/><rect x="53" y="10" width="3" height="42" fill="#64748b"/>' +
    '<rect x="10" y="16" width="44" height="5" rx="1.5" fill="#e2e8f0"/><rect x="22" y="15" width="32" height="6" rx="1.5" fill="#a855f7"/><rect x="12" y="13.5" width="9" height="4" rx="1.5" fill="#f8fafc"/>' +
    '<rect x="8" y="21" width="48" height="3" fill="#475569"/>' +
    '<path d="M47 24 V38 M51 24 V38 M47 28 h4 M47 32 h4 M47 36 h4" stroke="#94a3b8" stroke-width="1"/>' +
    '<rect x="10" y="38" width="44" height="6" rx="1.5" fill="#e2e8f0"/><rect x="26" y="37" width="28" height="7" rx="1.5" fill="#3b82f6"/><rect x="12" y="35.5" width="9" height="4" rx="1.5" fill="#f8fafc"/>' +
    '<rect x="8" y="44" width="48" height="3" fill="#475569"/>' +
    '<g class="f-bubbles" fill="#93c5fd"><circle cx="16" cy="11" r="1.1"/><circle cx="19" cy="9" r=".9"/><circle cx="22" cy="7" r=".7"/></g>' +
    '</g>',
  // Water cooler; bubbles glug up while someone pours
  waterCooler:
    '<g>' +
    '<rect x="18" y="51" width="28" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="24" y="8" width="16" height="20" rx="4" fill="#7dd3fc" opacity=".35" stroke="#38bdf8" stroke-width="1"/>' +
    '<rect class="f-fluid" x="26" y="12" width="12" height="14" rx="3" fill="#0ea5e9" opacity=".45"/>' +
    '<g class="f-bubbles" fill="#e0f2fe"><circle cx="30" cy="24" r="1"/><circle cx="34" cy="25" r=".8"/><circle cx="32" cy="23" r=".7"/></g>' +
    '<rect x="29" y="26" width="6" height="3" fill="#38bdf8" opacity=".7"/>' +
    '<rect x="22" y="28" width="20" height="24" rx="2" fill="#e5e7eb" stroke="#94a3b8" stroke-width="1"/>' +
    '<rect x="29" y="33" width="6" height="3" rx=".8" fill="#3b82f6"/><rect x="26" y="44" width="12" height="2" rx=".8" fill="#94a3b8"/>' +
    '<path d="M44 40 h5 l-1 9 h-3 z" fill="#f8fafc" stroke="#cbd5e1" stroke-width=".6"/><path d="M44.3 43 h4.4 M44.6 46 h3.8" stroke="#cbd5e1" stroke-width=".6"/>' +
    '</g>',
  // 3D printer; the head slides while it prints
  printer3d:
    '<g>' +
    '<rect x="10" y="51" width="44" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="12" y="10" width="40" height="42" rx="2" fill="#111827" stroke="#64748b" stroke-width="1.6"/>' +
    '<rect x="12" y="10" width="40" height="4" rx="1" fill="#475569"/>' +
    '<path d="M14 18 H50" stroke="#94a3b8" stroke-width="1.2"/>' +
    '<g class="f-head"><rect x="27" y="15.5" width="10" height="6" rx="1" fill="#f59e0b"/><path d="M32 21.5 v3" stroke="#fbbf24" stroke-width="1.4"/></g>' +
    '<rect x="25" y="33" width="14" height="8" rx="1" fill="#22d3ee" opacity=".75"/><path d="M25 35.5 h14 M25 38 h14" stroke="#0e7490" stroke-width=".6"/>' +
    '<rect x="18" y="41" width="28" height="3" fill="#1e293b"/>' +
    '<rect x="12" y="44" width="40" height="8" fill="#334155"/>' +
    '<rect x="38" y="46" width="10" height="4" rx=".6" fill="#0f172a"/><path d="M39.5 48 h6" stroke="#22d3ee" stroke-width=".8"/>' +
    '<circle class="f-led" cx="16" cy="48" r="1.3" fill="#22c55e"/>' +
    '</g>',
};

// What an idle robot does at each decor piece (dx: px from the piece's centre to sit at)
const DECOR_IDLE = {
  coffeeBar:   { pose: 'stand', emote: '☕', stance: 24 },
  bookshelf:   { pose: 'read',  emote: '📖', stance: 22 },
  arcade:      { pose: 'type',  emote: '🎮', stance: 17 },
  plantWall:   { pose: 'stand', emote: '🌱', stance: 26 },
  bunk:        { pose: 'sit',   emote: '💤', dx: -8 },
  waterCooler: { pose: 'stand', emote: '💧', stance: 15 },
  printer3d:   { pose: 'think', emote: '👀', stance: 22 },
};
const DECOR_KINDS = Object.keys(AI_DECOR);

// The art for a piece: its room's look (variant 1 = the alternate), or a decor piece
function furnitureArt(kind, variant) {
  return (variant && AI_FURNITURE_ALT[kind]) || AI_FURNITURE[kind] || AI_DECOR[kind] || '';
}
