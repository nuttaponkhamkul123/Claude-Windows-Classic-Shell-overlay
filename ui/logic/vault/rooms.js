// Vault view: room types (label + colour) and the 2.5D furniture art.
// Loaded right after app.js; shares its globals (sessionsList, robotHueFor, …).

function sessionVaultMeta(session, state) {
  if (state === 'running') {
    const act = currentActivity(session);
    const pose = activityPose(act);
    const rooms = {
      hammer: 'forge',
      type: 'lab',
      read: 'library',
      search: 'recon',
      web: 'comms',
      think: 'command',
      run: 'corridor',
    };
    return { pose, room: rooms[pose] || 'corridor' };
  }
  if (state === 'attention') return { pose: 'done', room: 'alert' };
  return { pose: 'walk', room: 'lounge' };
}

const VAULT_ROOMS = {
  forge:    { label: 'TOOL FORGE' },
  lab:      { label: 'CODING LAB' },
  library:  { label: 'CONTEXT ARCHIVE' },
  recon:    { label: 'SEARCH & RAG' },
  comms:    { label: 'MCP & WEB' },
  command:  { label: 'PLANNER CORE' },
  corridor: { label: 'AGENT RUNWAY' },
  alert:    { label: 'APPROVAL GATE' },
  lounge:   { label: 'STANDBY BAY' },
};

// 2.5D shaded AI-task furniture pieces (each rendered in its own 64x56 SVG so aspect ratio never stretches)
const AI_FURNITURE = {
  diffDesk:
    '<g>' +
    '<rect x="6" y="51" width="52" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    // desk legs & top with 2.5D bevel
    '<rect x="10" y="38" width="4" height="14" fill="#334155"/><rect x="50" y="38" width="4" height="14" fill="#334155"/>' +
    '<rect x="6" y="35" width="52" height="4" rx="1" fill="#64748b"/><rect x="6" y="35" width="52" height="1.5" fill="#94a3b8"/>' +
    // monitor stands
    '<rect x="19" y="31" width="4" height="4" fill="#475569"/><rect x="41" y="31" width="4" height="4" fill="#475569"/>' +
    // dual monitors with code/diff
    '<rect x="10" y="15" width="22" height="16" rx="2" fill="#0f172a" stroke="#475569" stroke-width="1.2"/>' +
    '<rect class="f-screen" x="12" y="17" width="18" height="12" rx="1" fill="#082f49"/>' +
    '<g class="f-code"><path d="M14 20 h10 M14 23 h13" stroke="#34d399" stroke-width="1.4"/><path d="M14 26 h8" stroke="#f87171" stroke-width="1.4"/></g>' +
    '<rect x="34" y="16" width="20" height="15" rx="2" fill="#0f172a" stroke="#475569" stroke-width="1.2"/>' +
    '<rect class="f-screen" x="36" y="18" width="16" height="11" rx="1" fill="#0c1e35"/>' +
    '<g class="f-code f-code-2"><path d="M38 21 h11 M38 24 h8 M38 27 h10" stroke="#38bdf8" stroke-width="1.3"/></g>' +
    // keyboard + mug
    '<rect x="20" y="33.5" width="16" height="2" rx=".8" fill="#cbd5e1"/>' +
    '<rect x="47" y="31" width="4" height="4" rx=".8" fill="#e2e8f0"/><path d="M51 32 h1.5 v2 h-1.5" fill="none" stroke="#e2e8f0" stroke-width=".8"/>' +
    '</g>',
  gpuRack:
    '<g>' +
    '<rect x="14" y="51" width="36" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="16" y="10" width="32" height="42" rx="2" fill="#1e293b" stroke="#64748b" stroke-width="1.2"/>' +
    '<rect x="18" y="12" width="28" height="38" rx="1" fill="#0f172a"/>' +
    // 3 compute blades
    '<rect x="20" y="14" width="24" height="8" rx="1" fill="#1e293b"/><circle cx="24" cy="18" r="1.4" class="f-led" fill="#22d3ee"/><circle cx="29" cy="18" r="1.4" class="f-led" fill="#10b981"/><path d="M34 18 h7" stroke="#475569" stroke-width="1.2"/>' +
    '<rect x="20" y="24" width="24" height="8" rx="1" fill="#1e293b"/><circle cx="24" cy="28" r="1.4" class="f-led" fill="#f59e0b"/><circle cx="29" cy="28" r="1.4" class="f-led" fill="#22d3ee"/><path d="M34 28 h7" stroke="#475569" stroke-width="1.2"/>' +
    '<rect x="20" y="34" width="24" height="13" rx="1" fill="#172030"/>' +
    '<circle class="f-fan" cx="32" cy="40.5" r="4.5" fill="#0f172a" stroke="#38bdf8" stroke-width="1" stroke-dasharray="3 2"/>' +
    '<circle cx="32" cy="40.5" r="1.5" fill="#38bdf8"/>' +
    '</g>',
  promptTerm:
    '<g>' +
    '<rect x="12" y="51" width="40" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    // kiosk pedestal + angled CRT/terminal
    '<rect x="24" y="35" width="16" height="17" fill="#334155"/><rect x="18" y="48" width="28" height="4" rx="1" fill="#475569"/>' +
    '<rect x="14" y="13" width="36" height="24" rx="3" fill="#334155" stroke="#64748b" stroke-width="1.2"/>' +
    '<rect x="17" y="16" width="30" height="18" rx="1.5" fill="#061826"/>' +
    '<path class="f-term" d="M21 22 l3.5 2.5 l-3.5 2.5 M27 27 h11 M21 30 h18" fill="none" stroke="#22d3ee" stroke-width="1.5" stroke-linecap="round"/><rect class="f-cursor" x="40.5" y="29" width="3" height="2.2" fill="#22d3ee"/>' +
    '</g>',
  whiteboard:
    '<g>' +
    '<rect x="10" y="51" width="44" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M16 39 v13 M48 39 v13 M12 50 h8 M44 50 h8" stroke="#64748b" stroke-width="1.8" stroke-linecap="round"/>' +
    '<rect x="10" y="12" width="44" height="28" rx="2" fill="#0f2544" stroke="#60a5fa" stroke-width="1.3"/>' +
    // agent workflow graph
    '<circle cx="19" cy="23" r="3.2" fill="#38bdf8"/><circle cx="32" cy="19" r="3.2" fill="#a78bfa"/><circle cx="44" cy="28" r="3.2" fill="#34d399"/>' +
    '<path class="f-draw" d="M22 22 L29 20 M35 20 L42 26 M21 25 L41 28" stroke="#93c5fd" stroke-width="1.2" opacity=".85"/>' +
    '<rect x="14" y="37" width="36" height="2.5" rx="1" fill="#475569"/>' +
    '</g>',
  vectorPods:
    '<g>' +
    '<rect x="10" y="51" width="44" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    // base platform
    '<rect x="12" y="45" width="40" height="7" rx="1.5" fill="#1e293b" stroke="#475569" stroke-width="1"/>' +
    // two glass cryo/vector cylinders
    '<rect x="16" y="15" width="13" height="30" rx="3" fill="#06281e" stroke="#34d399" stroke-width="1.1"/>' +
    '<rect class="f-fluid" x="19" y="23" width="7" height="19" rx="2" fill="#10b981" opacity=".55"/>' +
    '<rect x="35" y="15" width="13" height="30" rx="3" fill="#06281e" stroke="#34d399" stroke-width="1.1"/>' +
    '<rect class="f-fluid f-fluid-2" x="38" y="20" width="7" height="22" rx="2" fill="#34d399" opacity=".6"/>' +
    '<rect x="15" y="13" width="15" height="4" rx="1" fill="#475569"/><rect x="34" y="13" width="15" height="4" rx="1" fill="#475569"/>' +
    '</g>',
  mcpDock:
    '<g>' +
    '<rect x="10" y="51" width="44" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="14" y="20" width="36" height="32" rx="2" fill="#1e1b36" stroke="#8b5cf6" stroke-width="1.2"/>' +
    '<rect x="18" y="24" width="28" height="10" rx="1.5" fill="#2e1065"/>' +
    '<circle class="f-led" cx="24" cy="29" r="2" fill="#a78bfa"/><circle class="f-led" cx="32" cy="29" r="2" fill="#22d3ee"/><circle class="f-led" cx="40" cy="29" r="2" fill="#34d399"/>' +
    '<path class="f-cable" d="M24 38 v10 M32 38 v10 M40 38 v10" stroke="#7c3aed" stroke-width="2" stroke-linecap="round"/>' +
    '</g>',
  forgeCore:
    '<g>' +
    '<rect x="8" y="51" width="48" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="10" y="18" width="28" height="34" rx="2" fill="#2a1d12" stroke="#b45309" stroke-width="1.2"/>' +
    '<circle class="f-fire" cx="24" cy="35" r="8" fill="#ea580c" opacity=".55"/><circle cx="24" cy="35" r="4.5" fill="#fde047" opacity=".85"/>' +
    // anvil beside furnace
    '<path d="M40 42 h16 l-3 4 h-10 z" fill="#475569"/><rect x="44" y="46" width="8" height="6" fill="#334155"/>' +
    '</g>',
  rechargePod:
    '<g>' +
    '<rect x="10" y="51" width="44" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    // cozy sofa + coffee table
    '<rect x="10" y="34" width="28" height="18" rx="3" fill="#334155" stroke="#64748b" stroke-width="1.1"/>' +
    '<rect x="13" y="29" width="22" height="7" rx="2" fill="#475569"/>' +
    '<rect x="10" y="33" width="4" height="19" rx="1.5" fill="#475569"/><rect x="34" y="33" width="4" height="19" rx="1.5" fill="#475569"/>' +
    // potted plant
    '<rect x="44" y="42" width="10" height="10" rx="1.5" fill="#9a3412"/><circle cx="49" cy="36" r="6" fill="#16a34a"/><circle cx="46" cy="38" r="3.5" fill="#22c55e"/>' +
    '</g>',
  ctxTank:
    '<g>' +
    '<rect x="16" y="51" width="32" height="3" rx="1.5" fill="rgba(0,0,0,.45)"/>' +
    '<rect x="20" y="12" width="24" height="40" rx="6" fill="#0c192c" stroke="#64748b" stroke-width="1.2"/>' +
    '<rect class="f-fluid" x="23" y="26" width="18" height="23" rx="4" fill="#06b6d4" opacity=".5"/><g class="f-bubbles" fill="#a5f3fc"><circle cx="28" cy="46" r="1.2"/><circle cx="33" cy="47" r="1"/><circle cx="37" cy="45" r=".9"/></g>' +
    '<path d="M25 20 h14 M25 32 h14 M25 42 h14" stroke="#94a3b8" stroke-width=".9" opacity=".65"/>' +
    '</g>',
};

const ROOM_FURNITURE_POOLS = {
  forge:    ['forgeCore', 'gpuRack', 'mcpDock', 'promptTerm', 'ctxTank'],
  lab:      ['diffDesk', 'gpuRack', 'promptTerm', 'whiteboard', 'ctxTank'],
  library:  ['vectorPods', 'whiteboard', 'diffDesk', 'ctxTank', 'promptTerm'],
  recon:    ['vectorPods', 'whiteboard', 'promptTerm', 'gpuRack', 'mcpDock'],
  comms:    ['mcpDock', 'promptTerm', 'gpuRack', 'whiteboard', 'ctxTank'],
  command:  ['whiteboard', 'diffDesk', 'ctxTank', 'gpuRack', 'promptTerm'],
  corridor: ['ctxTank', 'rechargePod', 'gpuRack', 'mcpDock'],
  alert:    ['mcpDock', 'ctxTank', 'gpuRack', 'promptTerm'],
  lounge:   ['rechargePod', 'diffDesk', 'promptTerm', 'whiteboard', 'vectorPods', 'gpuRack', 'mcpDock', 'ctxTank'],
};
