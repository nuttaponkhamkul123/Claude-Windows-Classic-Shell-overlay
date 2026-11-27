// The activity line above the input box ("Running a command  npm run build   0:42 · 7 steps"), the row of helper
// agents (sub-agents) walking beside it, and the avatar jump animation between header and activity line.
// Moved out of app.js. Loaded BEFORE app.js: it only declares things; whatever it needs from app.js
// (chatStream, sessionsList, …) is used when a function runs, not when this file loads.
// ===========================================================================
// Activity line — says exactly what the agent is doing right now
//   ◌ Running a command   npm run build                     0:42 · 7 steps
// shown above the input box while a session works, instead of a vague
// "Claude is thinking..." message in the chat.
// ===========================================================================
var liveActivity = new Map();   // sessionId -> { act, at }  (from a HUD-sent reply's live stream)
var activityFirstSeen = new Map(); // sessionId -> ms when we first saw it running
var activityTimer = null;

function baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
}
function firstLine(t, max = 120) {
  const l = String(t || '').split('\n')[0].trim();
  return l.length > max ? l.slice(0, max - 1) + '…' : l;
}

// { verb, target } for a tool call
function describeActivity(act, agent) {
  if (!act) return { verb: `${agent} is working`, target: '' };
  if (act.kind === 'compacting') return { verb: 'Compacting the conversation', target: act.target || '' };
  if (act.kind === 'sending') return { verb: `Sending your message to ${agent}…`, target: '' };
  if (act.kind === 'writing') return { verb: 'Writing the reply', target: '' };
  if (act.kind === 'thinking') {
    return act.steps > 0
      ? { verb: 'Thinking about the next step', target: '' }
      : { verb: 'Reading your message and thinking', target: '' };
  }
  const tool = act.tool || 'a tool';
  const i = act.input || {};
  const m = tool.match(/^mcp__(.+?)__(.+)$/);
  if (m) return { verb: `Using ${m[1]} › ${m[2]}`, target: firstLine(i.query || i.url || i.path || i.name || '') };
  switch (tool) {
    case 'Bash': case 'PowerShell': case 'run_command':
      return { verb: (i.description || i.toolSummary) ? firstLine(i.description || i.toolSummary, 60) : 'Running a command', target: firstLine(i.command || i.CommandLine) };
    case 'Read': case 'view_file': case 'read_file': case 'view_file_outline': case 'view_code_item':
      return { verb: 'Reading', target: baseName(i.file_path || i.AbsolutePath || i.Path || i.File) };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'edit_file': case 'replace_file_content': case 'multi_replace_file_content':
      return { verb: 'Editing', target: baseName(i.file_path || i.notebook_path || i.Path || i.TargetFile) };
    case 'Write': case 'write_file':
      return { verb: 'Writing', target: baseName(i.file_path || i.Path || i.TargetFile) };
    case 'Grep': case 'grep_search':
      return { verb: 'Searching the code for', target: firstLine(i.pattern || i.Query) };
    case 'Glob': case 'find_by_name': case 'list_dir':
      return { verb: 'Looking for files', target: firstLine(i.pattern || i.Pattern || baseName(i.DirectoryPath || i.SearchDirectory)) };
    case 'WebSearch': case 'search_web':
      return { verb: 'Searching the web for', target: firstLine(i.query) };
    case 'WebFetch': case 'read_url_content': {
      const u = i.url || i.Url || '';
      let host = u;
      try { host = new URL(u).host; } catch (e) {}
      return { verb: 'Reading a web page', target: host };
    }
    case 'Task': case 'Agent': case 'invoke_subagent': case 'swarm':
      return { verb: 'Working with a sub-agent', target: firstLine(i.description || i.Role || i.prompt || i.Prompt || i.brief, 80) };
    case 'TodoWrite': case 'task_boundary':
      return { verb: 'Updating its task status', target: firstLine(i.TaskStatus || i.TaskName || '', 60) };
    case 'manage_task': case 'command_status':
      return { verb: 'Checking background task', target: firstLine(i.TaskId || i.CommandId || '') };
    case 'ask_question': case 'AskUserQuestion':
      return { verb: 'Asking you a question', target: '' };
    case 'Skill': return { verb: 'Using a skill', target: i.skill || '' };
    case 'tool': return { verb: 'Using a tool', target: '' };
    default:
      if (/^browser_/i.test(tool)) return { verb: 'Using the browser', target: firstLine(i.url || i.Url || tool.replace(/^browser_/, ''), 60) };
      return { verb: `Using ${tool}`, target: '' };
  }
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

function currentActivity(s) {
  if (s.context?.compacting) {
    return { kind: 'compacting', target: s.context.used ? `${fmtTokens(s.context.used)} tokens → summary` : '' };
  }
  const live = liveActivity.get(s.id);
  if (live && Date.now() - live.at < 30000) {
    // "Sending…" only until the transcript shows the new turn
    const transcriptCaughtUp = live.act.kind === 'sending' && s.activity?.since && s.activity.since >= live.act.since - 2000;
    if (!transcriptCaughtUp) return { ...s.activity, ...live.act, since: live.act.since || s.activity?.since, steps: s.activity?.steps };
  }
  if (s.activity) return s.activity;
  // Sent from the HUD, transcript hasn't caught up yet
  if (s.runningSince) return { kind: 'sending' };
  return s.state === 'tool' ? { kind: 'tool', tool: 'tool' } : { kind: 'thinking', steps: 0 };
}

// Activity card: the session's robot runs in place on the left, recent steps below
var activityTrail = new Map(); // sessionId -> { sig, cur, steps: [{ icon, label, at }] }
var activityTrailOpen = false;  // the "✓ N done ▾" list is expanded
function activityIcon(act) {
  const t = act.tool || '';
  if (act.kind === 'compacting') return '🗜';
  if (/Bash|PowerShell|command/i.test(t)) return '⌨';
  if (/Read|view|read_/i.test(t)) return '📖';
  if (/Edit|replace|Write|write_/i.test(t)) return '✏';
  if (/Grep|Glob|search|find|list_dir/i.test(t)) return '🔍';
  if (/Web|url|browser/i.test(t)) return '🌐';
  if (/Task|Agent|subagent|swarm/i.test(t)) return '🤖';
  return '⚙';
}

// What the robot acts out for the current step (poses in features.css)
function activityPose(act) {
  const t = act.tool || '';
  if (act.kind === 'compacting' || act.kind === 'writing') return 'type';
  if (act.kind === 'thinking') return 'think';
  if (act.kind !== 'tool') return 'run';
  if (/Bash|PowerShell|command/i.test(t)) return 'hammer';
  if (/Edit|replace|Write|write_|Notebook/i.test(t)) return 'type';
  if (/Read|view|read_/i.test(t) && !/url/i.test(t)) return 'read';
  if (/Grep|Glob|search_web|WebSearch/i.test(t)) return /web/i.test(t) ? 'web' : 'search';
  if (/search|find|list_dir/i.test(t)) return 'search';
  if (/Web|url|browser/i.test(t)) return 'web';
  return 'run';
}

function renderActivityProgress(row, s, act, verb, target) {
  let run = row.querySelector('.act-runwrap');
  if (!run) {
    run = document.createElement('div');
    run.className = 'act-runwrap';
    run.innerHTML = '<span class="act-ground"></span><span class="act-bot"></span>';
    row.prepend(run);
  }
  let box = row.querySelector('.act-progress');
  if (!box) {
    box = document.createElement('div');
    box.className = 'act-progress';
    box.innerHTML = '<div class="act-trail"></div>';
    row.appendChild(box);
  }
  // Same colour as the contact picture (the runner is drawn in the default robot palette)
  // Same colour AND outfit as the contact picture (hat, glasses, clothes in profile)
  const hue = typeof robotHueFor === 'function' ? robotHueFor(s) : 0;
  const outfit = typeof window.robotOutfitFor === 'function' ? window.robotOutfitFor(s) : null;
  const bot = run.querySelector('.act-bot');
  // waiting for your OK and no helper's step matches the request: the lead raises its hand
  const req = pendingApprovalFor(s);
  const leadAsks = !!req && !helperAsking(s, req);
  const pose = leadAsks ? 'done' : activityPose(act);
  const look = `${hue}|${outfit ? JSON.stringify(outfit) : ''}|${pose}|${leadAsks ? 'ask' : ''}`;
  if (bot.dataset.look !== look && typeof window.buildRunnerSvg === 'function') {
    bot.dataset.look = look;
    bot.innerHTML = window.buildRunnerSvg(hue, outfit, pose) +
      (leadAsks ? '<span class="act-bubble ask">!</span>' : pose === 'think' ? '<span class="act-bubble"><i></i><i></i><i></i></span>' : '');
    run.className = `act-runwrap pose-${pose}`;
  }

  // Finished steps: every time the activity changes, the old one is "done".
  // Shown as one compact pill ("stacked" icons + count); click it for the full list.
  let tr = activityTrail.get(s.id);
  if (!tr) { tr = { sig: '', cur: null, steps: [] }; activityTrail.set(s.id, tr); }
  const sig = `${act.kind}|${verb}|${target}`;
  if (sig !== tr.sig) {
    if (tr.cur && tr.cur.real) tr.steps = [...tr.steps, tr.cur].slice(-30);
    tr.sig = sig;
    tr.cur = { icon: activityIcon(act), verb, target, at: Date.now(), real: act.kind === 'tool' || act.kind === 'compacting' };
    const cmd = act.kind === 'tool' && /^(Bash|PowerShell|run_command)$/.test(act.tool || '') && (act.input?.command || act.input?.CommandLine);
    if (cmd) { tr.cur.cmd = String(cmd); tr.cur.lang = /PowerShell/.test(act.tool) ? 'powershell' : 'bash'; }
  }

  let pill = row.querySelector('.act-stack');
  if (!pill) {
    pill = document.createElement('button');
    pill.className = 'act-stack';
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      activityTrailOpen = !activityTrailOpen;
      if (currentActiveSession) renderActivity(currentActiveSession);
    });
    row.appendChild(pill);
    // a click anywhere on the bar does the same (not on its other buttons, helpers or the open list)
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, a, .team-mate, .act-progress') || pill.style.display === 'none') return;
      pill.click();
    });
  }
  const n = tr.steps.length;
  pill.style.display = n ? '' : 'none';
  row.classList.toggle('has-steps', n > 0);
  pill.classList.toggle('open', activityTrailOpen);
  pill.title = activityTrailOpen ? 'Hide finished steps' : 'Show finished steps';
  pill.textContent = '';
  const icons = document.createElement('span');
  icons.className = 'act-stack-icons';
  for (const st of tr.steps.slice(-3).reverse()) {
    const i = document.createElement('span');
    i.className = 'act-stack-ico';
    i.textContent = st.icon;
    icons.appendChild(i);
  }
  const label = document.createElement('span');
  label.textContent = `${n} done`;
  const caret = document.createElement('span');
  caret.className = 'act-stack-caret';
  caret.textContent = activityTrailOpen ? '▴' : '▾';
  pill.append(icons, label, caret);

  renderActivityTeam(row, s);

  const trail = box.querySelector('.act-trail');
  box.style.display = n && activityTrailOpen ? '' : 'none';
  if (!(n && activityTrailOpen)) { trail.textContent = ''; trail.dataset.sig = ''; return; }
  // only rebuilt when a step is added (so an open command can be read, scrolled and selected)
  const listSig = `${s.id}|${n}|${tr.steps[n - 1].at}`;
  if (trail.dataset.sig === listSig) {
    trail.querySelectorAll('.act-step-time').forEach((el) => { el.textContent = fmtElapsed(Date.now() - Number(el.dataset.at)) + ' ago'; });
    return;
  }
  trail.dataset.sig = listSig;
  trail.textContent = '';
  for (const st of [...tr.steps].reverse()) {
    const r = document.createElement('div');
    r.className = 'act-step';
    const ic = document.createElement('span'); ic.className = 'act-step-ico'; ic.textContent = st.icon;
    const v = document.createElement('span'); v.className = 'act-step-verb'; v.textContent = st.verb;
    const t = document.createElement('span'); t.className = 'act-step-target'; t.textContent = st.target || '';
    const when = document.createElement('span'); when.className = 'act-step-time'; when.dataset.at = st.at; when.textContent = fmtElapsed(Date.now() - st.at) + ' ago';
    r.title = st.target ? `${st.verb} ${st.target}` : st.verb;
    r.append(ic, v, t, when);
    trail.appendChild(r);
    if (st.cmd && typeof window.addCommandToggle === 'function') {
      trail.appendChild(window.addCommandToggle(r, st, activityCmdOpen.has(st.at), (open) => { if (open) activityCmdOpen.add(st.at); else activityCmdOpen.delete(st.at); }));
    }
  }
}
var activityCmdOpen = new Set(); // step times whose full command is shown in the bar's list

// Team stage: helper agents work next to the lead robot, each acting out its own step.
// New helpers pop out of a smoke puff as a page flies down the line to them; finished
// ones wave a ✓, walk the page back to the lead and poof. "+N" opens the full list.
const TEAM_MAX = 4;
const TEAM_HUE = { Explore: -40, Plan: 80, 'general-purpose': 190, claude: 140 };
function teamHue(type) {
  if (type in TEAM_HUE) return TEAM_HUE[type];
  let h = 0;
  for (const ch of String(type)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 12) * 30;
}
// Which helper (if any) a pending approval belongs to. The request doesn't say, so match
// it against each helper's current step (same tool, same command / file).
function pendingApprovalFor(s) {
  if (typeof pendingApprovals === 'undefined' || !s) return null;
  for (const r of pendingApprovals.values()) if (r.sessionId === s.id) return r;
  return null;
}
function helperAsking(s, req) {
  if (!req) return null;
  const i = req.input || {};
  const want = String(i.command || i.file_path || i.pattern || i.query || i.url || i.description || '').split('\n')[0].slice(0, 100);
  return (s.subagents || []).find((a) => !a.finished && a.tool === req.toolName && a.target === want) || null;
}

const teamLeaving = new Set();  // helper ids walking their page back to the lead
const teamRetired = new Set();  // helper ids that have handed back and gone
let teamListOpen = false;
function renderActivityTeam(row, s) {
  const subs = Array.isArray(s.subagents) ? s.subagents : [];
  let team = row.querySelector('.act-team');
  // one already finished when first seen (e.g. you opened the chat late): nothing to hand back
  const mates0 = team?.querySelector('.team-mates');
  for (const a of subs) {
    if (a.finished && !teamLeaving.has(a.id) && !mates0?.querySelector(`.team-mate[data-id="${CSS.escape(a.id)}"]`)) teamRetired.add(a.id);
  }
  const visible = subs.filter((a) => !teamRetired.has(a.id) && !teamLeaving.has(a.id));
  if (!visible.length) {
    if (team && !team.querySelector('.team-mate.leaving')) {
      for (const m of team.querySelectorAll('.team-mate')) teamPoof(m);
      team.remove();
    }
    return;
  }
  if (!team) {
    team = document.createElement('div');
    team.className = 'act-team';
    team.innerHTML = '<span class="team-line"><i></i></span><div class="team-mates"></div><button class="team-more"></button><div class="team-list" hidden></div>';
    team.querySelector('.team-more').addEventListener('click', (e) => {
      e.stopPropagation();
      teamListOpen = !teamListOpen;
      if (currentActiveSession) renderActivity(currentActiveSession);
    });
    row.appendChild(team);
  }
  const mates = team.querySelector('.team-mates');
  const shown = visible.slice(-TEAM_MAX);
  const keep = new Set(shown.map((a) => a.id));
  for (const m of [...mates.children]) if (!keep.has(m.dataset.id) && !m.classList.contains('leaving')) { teamPoof(m); m.remove(); }

  const asker = helperAsking(s, pendingApprovalFor(s));
  for (const a of shown) {
    let m = mates.querySelector(`.team-mate[data-id="${CSS.escape(a.id)}"]`);
    const isNew = !m;
    if (isNew) {
      m = document.createElement('div');
      m.className = 'team-mate';
      m.dataset.id = a.id;
      m.innerHTML = '<span class="team-bot"></span><span class="team-tag"></span><span class="team-task"></span>';
      mates.appendChild(m);
    }
    const asking = asker?.id === a.id;
    const pose = a.finished || asking ? 'done' : activityPose(a.tool ? { kind: 'tool', tool: a.tool } : { kind: 'thinking' });
    const look = `${pose}|${a.finished ? 'ok' : asking ? 'ask' : ''}`;
    const bot = m.querySelector('.team-bot');
    if (bot.dataset.look !== look && typeof window.buildRunnerSvg === 'function') {
      bot.dataset.look = look;
      bot.innerHTML = window.buildRunnerSvg(teamHue(a.type), null, pose) +
        (a.finished ? '<span class="act-bubble ok">✓</span>' : asking ? '<span class="act-bubble ask">!</span>'
          : pose === 'think' ? '<span class="act-bubble"><i></i><i></i><i></i></span>' : '');
      m.className = `team-mate pose-${pose}${asking ? ' asking' : ''}`;
    }
    m.querySelector('.team-tag').textContent = a.type;
    m.querySelector('.team-task').textContent = a.task;
    m.title = `${a.type}: ${a.task}` + (a.finished ? '\n✓ Done' : asking ? `\nWaiting for your OK: ${a.tool} ${a.target || ''}`
      : a.tool ? `\nNow: ${a.tool}${a.target ? ' ' + a.target : ''}` : '\nNow: thinking');
    if (isNew) requestAnimationFrame(() => {
      const r = bot.getBoundingClientRect();
      if (r.width) smokePuff(r.left + r.width / 2, r.top + r.height / 2, 30);
      // the hand-off: one page flies down the line to the new helper
      const line = team.querySelector('.team-line');
      line.classList.remove('handoff'); void line.offsetWidth; line.classList.add('handoff');
    });
    // finished: wave the ✓ for a moment, then walk the page back to the lead
    if (a.finished && !m.dataset.doneAt) {
      m.dataset.doneAt = String(Date.now());
      setTimeout(() => teamReturn(m, row, a), 1300);
    }
  }
  const more = team.querySelector('.team-more');
  const extra = visible.length - shown.length;
  more.style.display = extra > 0 ? '' : 'none';
  more.textContent = `+${extra}`;
  more.title = teamListOpen ? 'Hide the list' : `Show all ${visible.length} helpers`;
  more.classList.toggle('open', teamListOpen && extra > 0);

  // "+N" opens the full list of helpers
  const list = team.querySelector('.team-list');
  list.hidden = !(teamListOpen && extra > 0);
  if (!list.hidden) {
    list.textContent = '';
    for (const a of subs) {
      const r = document.createElement('div');
      r.className = `team-li${a.finished ? ' done' : ''}`;
      const dot = document.createElement('i');
      dot.style.background = shiftHexHue('#62b6d8', teamHue(a.type));
      const tag = document.createElement('b'); tag.textContent = a.type;
      const task = document.createElement('span'); task.className = 'team-li-task'; task.textContent = a.task;
      const now = document.createElement('span'); now.className = 'team-li-now';
      now.textContent = a.finished ? '✓ done' : asker?.id === a.id ? '! needs your OK' : a.tool ? `${a.tool}${a.target ? ' ' + a.target : ''}` : 'thinking…';
      r.title = `${a.type}: ${a.task}`;
      r.append(dot, tag, task, now);
      list.appendChild(r);
    }
  }
}
// A finished helper turns, walks its page back up the line to the lead and poofs.
function teamReturn(m, row, a) {
  if (!m.isConnected || m.classList.contains('leaving')) return;
  teamLeaving.add(a.id);
  m.classList.add('leaving');
  const done = () => {
    const r = m.getBoundingClientRect();
    if (r.width) smokePuff(r.left + r.width / 2, r.top + r.height / 2, 26);
    m.remove();
    teamLeaving.delete(a.id);
    teamRetired.add(a.id);
    const run = row.querySelector('.act-runwrap');
    if (run) { run.classList.remove('got-page'); void run.offsetWidth; run.classList.add('got-page'); } // lead takes the page
    if (currentActiveSession) renderActivity(currentActiveSession);
  };
  const bot = m.querySelector('.team-bot');
  const lead = row.querySelector('.act-bot')?.getBoundingClientRect();
  const me = bot?.getBoundingClientRect();
  if (reducedMotion() || !lead || !me || !me.width || typeof window.buildRunnerSvg !== 'function') { done(); return; }
  bot.innerHTML = window.buildRunnerSvg(teamHue(a.type), null, 'walk') + '<span class="team-page"></span>';
  bot.style.transform = `scaleX(${lead.left + lead.width / 2 < me.left + me.width / 2 ? -1 : 1})`; // face the lead
  const dx = (lead.left + lead.width / 2) - (me.left + me.width / 2);
  const dy = (lead.bottom - 4) - me.bottom;
  const dur = Math.min(1600, Math.max(700, Math.hypot(dx, dy) * 12));
  m.animate([
    { transform: 'translate(0, 0)', opacity: 1 },
    { transform: `translate(${dx * 0.55}px, 0)`, opacity: 1, offset: 0.5 },            // along the bottom of the line…
    { transform: `translate(${dx}px, ${dy}px) scale(.8)`, opacity: 1, offset: 0.9 },   // …and up to the lead
    { transform: `translate(${dx}px, ${dy}px) scale(.6)`, opacity: 0 },
  ], { duration: dur, easing: 'linear', fill: 'forwards' }).finished.then(done, done);
}
function teamPoof(m) {
  const r = m.querySelector('.team-bot')?.getBoundingClientRect();
  if (r && r.width) smokePuff(r.left + r.width / 2, r.top + r.height / 2, 30);
}

var activityHideTimer = null;
function renderActivity(s) {
  const row = document.getElementById('activityRow');
  if (!row) return;
  const isAttn = s && (s.unread || s.state === 'attention');
  // helpers (sub-agents) still working keep the card up after the main reply ends
  // (a finished helper still counts until it has walked its page back to the lead)
  const onCard = (a) => !!document.querySelector(`#activityRow .team-mate[data-id="${CSS.escape(a.id)}"]`);
  const helpersBusy = (x) => (x?.subagents || []).some((a) => !a.finished || teamLeaving.has(a.id) || (!teamRetired.has(a.id) && onCard(a)));
  const working = s && !isAttn && !s.deliveryFailed && (s.status === 'running' || s.context?.compacting || helpersBusy(s));
  if (!working) {
    if (row.style.display === 'none') {
      avatarFrameImg()?.classList.remove('avatar-away'); // never leave the frame empty
      return;
    }
    // Still showing: the status often blinks to "done" for a moment between
    // tool calls. Only treat it as finished if it stays that way.
    if (!activityHideTimer) {
      activityHideTimer = setTimeout(() => {
        activityHideTimer = null;
        const cur = currentActiveSession;
        const still = cur && !(cur.unread || cur.state === 'attention') && !cur.deliveryFailed &&
          (cur.status === 'running' || cur.context?.compacting || helpersBusy(cur));
        if (still) return;
        avatarJumpBack(row);
        row.style.display = 'none';
        if (cur) {
          // keep the finished steps under the reply (features.js)
          const tr = activityTrail.get(cur.id);
          if (tr && typeof window.onActivityFinished === 'function') window.onActivityFinished(cur.id, tr.cur && tr.cur.real ? [...tr.steps, tr.cur] : tr.steps);
          activityFirstSeen.delete(cur.id); activityTrail.delete(cur.id);
        }
        activityTrailOpen = false; activityCmdOpen.clear();
        if (activityTimer) { clearInterval(activityTimer); activityTimer = null; }
      }, 1500);
    }
    return;
  }
  if (activityHideTimer) { clearTimeout(activityHideTimer); activityHideTimer = null; }
  if (!activityFirstSeen.has(s.id)) activityFirstSeen.set(s.id, Date.now());

  const agent = agentLabel(s.source, s.id);
  const mainBusy = s.status === 'running' || s.context?.compacting;
  const act = mainBusy ? currentActivity(s) : { kind: 'thinking', since: s.subagents.reduce((m, a) => Math.min(m, a.startedAt || m), Date.now()) };
  let { verb, target } = describeActivity(act, agent);
  if (!mainBusy) {
    const open = s.subagents.filter((a) => !a.finished);
    verb = open.length ? `Waiting for ${open.length} helper${open.length === 1 ? '' : 's'}` : 'Helpers handing back their work';
    target = open[0]?.task || '';
  }
  row.className = `activity-row kind-${act.kind || 'tool'}`;
  renderActivityProgress(row, s, act, verb, target);
  document.getElementById('activityVerb').textContent = verb;
  const tEl = document.getElementById('activityTarget');
  tEl.textContent = target;
  tEl.style.display = target ? '' : 'none';
  row.title = `${agent}: ${verb}${target ? ' ' + target : ''}` +
    (act.kind === 'tool' && act.input?.command ? `\n\n${act.input.command}` : '');

  const since = act.since || act.turnStartTs || s.runningSince || activityFirstSeen.get(s.id);
  const meta = document.getElementById('activityMeta');
  const tick = () => {
    const steps = act.steps || act.turnSteps || 0;
    meta.textContent = `${fmtElapsed(Date.now() - since)}${steps ? ` · ${steps} step${steps === 1 ? '' : 's'}` : ''}`;
  };
  tick();
  if (activityTimer) clearInterval(activityTimer);
  activityTimer = setInterval(() => {
    if (row.style.display === 'none' || !row.isConnected) { clearInterval(activityTimer); activityTimer = null; return; }
    tick();
  }, 1000);
  const wasHidden = row.style.display === 'none';
  row.style.display = '';
  if (wasHidden) avatarJumpToRunner(row);
}

// On send: the big contact avatar leaps out of its frame, arcs down into the
// activity card and vanishes in a puff of smoke; the runner appears from it.
// When the reply is done the runner poofs away and the avatar jumps back home.
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const avatarFrameImg = () => document.querySelector('#dpAgentImg img') || document.getElementById('dpAgentImg');

function smokePuff(x, y, size = 46) {
  const box = document.createElement('div');
  box.className = 'smoke-puff';
  Object.assign(box.style, { left: x + 'px', top: y + 'px' });
  const n = 10;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const core = i % 3 === 0; // a few big puffs in the middle so the cloud is solid
    const dist = size * (core ? 0.08 : 0.35 + Math.random() * 0.25);
    const r = size * (core ? 0.5 : 0.28 + Math.random() * 0.14);
    Object.assign(p.style, { width: r + 'px', height: r + 'px', marginLeft: -r / 2 + 'px', marginTop: -r / 2 + 'px' });
    box.appendChild(p);
    p.animate([
      { transform: 'translate(0,0) scale(.2)', opacity: 1 },
      { transform: `translate(${Math.cos(ang) * dist * 0.7}px, ${Math.sin(ang) * dist * 0.7 - 4}px) scale(1.15)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist - 10}px) scale(.6)`, opacity: 0 },
    ], { duration: 560 + Math.random() * 120, easing: 'ease-out', fill: 'forwards' });
  }
  // cartoon "pop" lines
  for (let i = 0; i < 4; i++) {
    const l = document.createElement('b');
    l.style.transform = `rotate(${i * 90 + 45}deg)`;
    box.appendChild(l);
    l.animate([{ opacity: 1, height: '2px', top: '-6px' }, { opacity: 0, height: '9px', top: `-${size * 0.75}px` }], { duration: 380, easing: 'ease-out', fill: 'forwards' });
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 800);
}

function makeGhost(img, rect) {
  const ghost = img.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.className = 'avatar-ghost';
  ghost.style.visibility = '';
  Object.assign(ghost.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
  document.body.appendChild(ghost);
  return ghost;
}
let avatarFlight = null; // the jump currently playing
function cancelAvatarFlight() {
  if (!avatarFlight) return;
  const f = avatarFlight;
  avatarFlight = null;
  f.anim.onfinish = null;
  f.anim.cancel();
  f.ghost.remove();
}
const frameImgOf = (el) => (el.tagName === 'IMG' ? el : (el.querySelector('img') || el));

function avatarJumpToRunner(row) {
  const home = avatarFrameImg();
  const wrap = row.querySelector('.act-runwrap');
  if (!home || !wrap) return;
  if (reducedMotion()) { home.classList.add('avatar-away'); return; }
  requestAnimationFrame(() => {
    const a = home.getBoundingClientRect();
    const b = wrap.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const k = Math.min(1, (b.height * 0.9) / a.height);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    cancelAvatarFlight();
    row.classList.add('runner-incoming');
    const ghost = makeGhost(frameImgOf(home), a);
    home.classList.add('avatar-away');
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1) rotate(0)' },
      { transform: `translate(${dx * 0.12}px, -26px) scale(1.06) rotate(-12deg)`, offset: 0.22, easing: 'ease-in' },
      { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotate(8deg)` },
    ], { duration: 700, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' });
    avatarFlight = { ghost, anim };
    anim.onfinish = () => {
      avatarFlight = null;
      // poof! the avatar vanishes, the runner appears out of the smoke
      smokePuff(b.left + b.width / 2, b.top + b.height / 2);
      ghost.animate([
        { opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(${k})` },
        { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${k * 0.3})` },
      ], { duration: 180, fill: 'forwards' }).onfinish = () => ghost.remove();
      setTimeout(() => {
        row.classList.remove('runner-incoming');
        wrap.animate([
          { transform: 'scale(.3)', opacity: 0 },
          { transform: 'scale(1.12, .9)', opacity: 1, offset: 0.6 },
          { transform: 'none', opacity: 1 },
        ], { duration: 300, easing: 'ease-out' });
      }, 140);
    };
  });
}

// Reply finished: the runner vanishes in smoke and the avatar hops back into its frame
function avatarJumpBack(row) {
  const home = avatarFrameImg();
  if (!home || !home.classList.contains('avatar-away')) return;
  const wrap = row.querySelector('.act-runwrap');
  const b = wrap && wrap.getBoundingClientRect();
  const a = home.getBoundingClientRect();
  if (reducedMotion() || !b || !b.width || !a.width) { home.classList.remove('avatar-away'); return; }
  smokePuff(b.left + b.width / 2, b.top + b.height / 2);
  const k = Math.min(1, (b.height * 0.9) / a.height);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  cancelAvatarFlight();
  const ghost = makeGhost(frameImgOf(home), a);
  const anim = ghost.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0 },
    { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 1, offset: 0.15 },
    { transform: `translate(${dx * 0.4}px, ${dy * 0.25 - 40}px) scale(${(k + 1) / 2}) rotate(-14deg)`, offset: 0.6, easing: 'ease-in' },
    { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
  ], { duration: 780, easing: 'ease-out', fill: 'forwards' });
  avatarFlight = { ghost, anim };
  anim.onfinish = () => {
    avatarFlight = null;
    ghost.remove();
    home.classList.remove('avatar-away');
    home.animate([{ transform: 'scale(1.18, .85)' }, { transform: 'scale(.94, 1.06)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
  };
}
