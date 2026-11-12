const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

// Antigravity: a finished step followed by this much silence = the run was cut off
const AG_INTERRUPTED_MS = 3 * 60 * 1000;
const INTERRUPTED_NOTE = '**Antigravity stopped before finishing.**\n\n' +
  'Its last step finished, but nothing happened after that — the run was probably interrupted ' +
  '(for example the HUD was restarted while it was working). Send a message such as "continue" to pick it up again.';

// Does this message END by asking the user something? Only the last sentence
// counts — a message that merely quotes a question ("Which model do you want?")
// in the middle is not waiting for an answer.
const QUESTION_PHRASES = /what would you like|would you like|should i|shall i|do you want|want me to|let me know|how would you|what should|can i|could i|may i/i;
const YES_NO_START = /^(would|do|does|did|should|shall|can|could|is|are|was|were|will|have|has|may|might|want|ready|ok(ay)?)\b/i;
function endsWithQuestion(text) {
  const t = String(text || '').replace(/[*_`>#]/g, '').trim();
  if (!t) return false;
  const tail = t.slice(-300);
  if (/\(\s*yes\s*\/\s*no\s*\)\s*$/i.test(tail)) return true;
  const end = tail.replace(/[\s"'”’)\]]+$/, '');
  if (!end.endsWith('?')) return false;
  const body = end.slice(0, -1);
  const cut = Math.max(body.lastIndexOf('. '), body.lastIndexOf('! '), body.lastIndexOf('? '), body.lastIndexOf('\n'));
  const sentence = body.slice(cut + 1).trim();
  return QUESTION_PHRASES.test(sentence) || YES_NO_START.test(sentence);
}

class MultiAISessionWatcher extends EventEmitter {
  constructor() {
    super();
    this.homedir = os.homedir();
    this.claudeProjectsDir = path.join(this.homedir, '.claude', 'projects');
    this.antigravityBrainDir = path.join(this.homedir, '.gemini', 'antigravity', 'brain');
    this.antigravityRoots = ['antigravity', 'antigravity-ide', 'antigravity-cli'].map((appDataDir) => ({
      appDataDir,
      rootDir: path.join(this.homedir, '.gemini', appDataDir),
      brainDir: path.join(this.homedir, '.gemini', appDataDir, 'brain'),
      convDir: path.join(this.homedir, '.gemini', appDataDir, 'conversations'),
      summaryDb: path.join(this.homedir, '.gemini', appDataDir, 'conversation_summaries.db'),
    }));
    this.agSummaryCache = new Map(); // summaryDb -> { mtime, byId }
    
    this.sessions = new Map();
    this.pollInterval = null;
    this.dismissedAlerts = new Set();
  }

  start() {
    console.log('[MultiWatcher] Starting multi-session AI activity watcher...');
    this.check();
    this.pollInterval = setInterval(() => this.check(), 800);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  dismiss(sessionId) {
    this.dismissedAlerts.add(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.unread = false;
      this.emitSync();
    }
  }

  setSessionRunning(sessionId, statusLabel = 'Running (Thinking...)', detailText = '') {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'running';
      session.statusLabel = statusLabel;
      session.state = 'thinking';
      session.unread = false;
      // Don't touch session.mtime: changing it forced an immediate re-parse of a
      // transcript that doesn't contain the new message yet → it read as "idle"
      // → false "finished" nudge right after sending. Instead remember when we
      // sent; the parsers keep it "running" until newer activity shows up.
      session.runningSince = Date.now();
      if (detailText) {
        session.detail = this.formatDetail(detailText);
      }
      this.emitSync();
    }
  }

  // ---- Context usage & compaction (Claude Code) ----
  // used    = tokens sent with the newest main-thread reply
  //           (input + cache writes + cache reads), or the compaction's
  //           post-size if a compaction happened after that reply
  // window  = model's context window (from Claude Code's per-model usage
  //           summary in "cost-state" entries; falls back to 200K)
  // compacting = the newest in-flight request is a compaction
  readClaudeContext(entries, model, prev) {
    let used = 0, usedTs = 0;
    let compactEntry = null, compactTs = 0;
    let latestReq = null, latestReqTs = 0;
    let latestAssistantTs = 0;
    let window = 0;
    let dequeueTs = 0, latestEventTs = 0;

    for (const e of entries) { // newest → oldest
      if (e.isSidechain) continue;
      const ts = Date.parse(e.timestamp) || 0;
      if (!dequeueTs && e.type === 'queue-operation' && e.operation === 'dequeue') dequeueTs = ts;
      if (!latestEventTs && (e.type === 'user' || e.type === 'assistant' || e.type === 'api-request' ||
          (e.type === 'system' && e.subtype === 'compact_boundary'))) latestEventTs = ts;
      if (!latestReq && e.type === 'api-request') { latestReq = e; latestReqTs = ts; }
      if (e.type === 'assistant' && e.message?.usage && !latestAssistantTs) {
        latestAssistantTs = ts;
        const u = e.message.usage;
        used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        usedTs = ts;
      }
      if (!compactEntry && e.type === 'system' && e.subtype === 'compact_boundary') {
        compactEntry = e; compactTs = ts;
      }
      if (!window && e.type === 'cost-state') {
        const mu = e.modelUsage || e.model_usage;
        const w = (model && mu?.[model]?.contextWindow) ||
          Object.values(mu || {}).map((m) => m?.contextWindow || 0).sort((a, b) => b - a)[0];
        if (w) window = w;
      }
    }

    // Current Claude Code no longer writes contextWindow, so learn it per model:
    // any request or compaction above 200K proves a 1M window.
    if (!this.modelWindows) this.modelWindows = {};
    const biggest = Math.max(used, compactEntry?.compactMetadata?.preTokens || 0);
    if (model && biggest > 200000) this.modelWindows[model] = Math.max(this.modelWindows[model] || 0, 1000000);
    if (model && window) this.modelWindows[model] = window;
    if (!window) {
      window = (model && this.modelWindows[model]) || prev?.context?.window ||
        (/\[1m\]/i.test(model || '') ? 1000000 : 200000);
    }

    let lastCompact = prev?.context?.lastCompact || null;
    if (compactEntry) {
      const m = compactEntry.compactMetadata || {};
      lastCompact = {
        trigger: m.trigger || 'auto',
        preTokens: m.preTokens || 0,
        postTokens: m.postTokens || 0,
        at: compactTs,
      };
      // A compaction newer than the newest reply → context is now the post-size
      if (compactTs > usedTs && m.postTokens) used = m.postTokens;
    }

    // In-flight compaction: newest request is a compaction and nothing newer answered it
    let compacting = !!(latestReq && latestReqTs >= latestAssistantTs && latestReqTs >= compactTs &&
      /compact/i.test(String(latestReq.querySource || latestReq.params?.querySource || '')));
    // /compact logs nothing while it runs, except a dequeued queue item. A
    // normal prompt writes its user entry within milliseconds, so a dequeue
    // that stays unanswered for a few seconds means a compaction is in progress.
    // All its entries (boundary, summary, "Compacted" output) are written at the end.
    let recheckAt = 0;
    if (!compacting && dequeueTs > latestEventTs) {
      const age = Date.now() - dequeueTs;
      if (age > 3000 && age < 10 * 60 * 1000) compacting = true;
      else if (age <= 3000) recheckAt = dequeueTs + 3100; // file stays quiet → look again
    }

    if (!used && prev?.context?.used) used = prev.context.used;
    return {
      used,
      window,
      pct: window ? Math.min(100, (used / window) * 100) : 0,
      compacting,
      lastCompact,
      recheckAt,
    };
  }

  // A send from the HUD failed (e.g. Antigravity not open): drop the
  // "running" hold and re-read the real state right away.
  cancelRunning(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.runningSince = null;
    session.sig = null;   // force Antigravity re-parse
    session.mtime = -1;   // force Claude re-parse
    this.check();
  }

  // The HUD-launched process for this session exited (e.g. `agy -p` finished or
  // was stopped by a denied command). The transcript may end mid-turn ("tool
  // finished, analysing…") so it would read as running forever. Mark it idle
  // until the session's files change again.
  markTurnEnded(sessionId, statusLabel = 'Idle (Ready)', detail = '') {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.endedTurns = this.endedTurns || new Map();
    this.endedTurns.set(sessionId, { sig: s.sig, mtime: s.mtime, statusLabel, detail });
    s.runningSince = null;
    s.sig = null;   // force a re-parse so the override is applied on fresh data
    s.mtime = -1;
    this.check();
  }

  applyEndedTurn(sessionId, updated) {
    const ended = this.endedTurns?.get(sessionId);
    if (!ended) return updated;
    // Only valid until the session starts writing again (new activity after the end)
    if (ended.appliedSig && updated.sig && updated.sig !== ended.appliedSig) {
      this.endedTurns.delete(sessionId);
      return updated;
    }
    if (updated.status !== 'running') {
      this.endedTurns.delete(sessionId);
      return updated;
    }
    return {
      ...updated,
      status: 'idle',
      state: 'waiting',
      statusLabel: ended.statusLabel,
      title: 'Antigravity stopped',
      detail: ended.detail ? this.formatDetail(ended.detail) : updated.detail,
      runningSince: null,
    };
  }

  // Hold expired (3 min with no new activity) → re-parse even if nothing changed on disk
  holdExpired(s) {
    return !!(s && s.status === 'running' && s.runningSince && Date.now() - s.runningSince > this.holdLimitMs(s) + 500);
  }

  // How long to wait for a HUD-sent message to show up in the session's files.
  // Claude: `claude -p` can take a while to start. Antigravity records a message
  // the moment it receives it, so 25 s of silence means it never arrived.
  holdLimitMs(s) {
    return s && s.source === 'antigravity' ? 25 * 1000 : 3 * 60 * 1000;
  }

  check() {
    let changed = false;
    if (this.checkClaudeSessions()) changed = true;
    if (this.checkAntigravitySessions()) changed = true;
    if (this.expireStaleRunning()) changed = true;

    if (changed) {
      this.emitSync();
    }
  }

  // -------------------------------------------------------------
  // Claude Code Multi-Session Scanner
  // -------------------------------------------------------------
  checkClaudeSessions() {
    if (!fs.existsSync(this.claudeProjectsDir)) return false;

    const cutoff = Date.now() - (48 * 60 * 60 * 1000);
    const foundFiles = [];

    const scan = (dir, depth = 0) => {
      if (depth > 2) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(fullPath, depth + 1);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs > cutoff) {
              foundFiles.push({ path: fullPath, mtime: stat.mtimeMs, size: stat.size });
            }
          }
        }
      } catch (err) {}
    };

    scan(this.claudeProjectsDir);

    foundFiles.sort((a, b) => b.mtime - a.mtime);
    const activeRecent = foundFiles.slice(0, 10);

    let anyChanged = false;
    for (const f of activeRecent) {
      const sessionId = 'claude_' + path.basename(f.path, '.jsonl');
      const existing = this.sessions.get(sessionId);

      if (!existing || existing.mtime !== f.mtime || existing.size !== f.size || this.holdExpired(existing) ||
          (existing.context?.recheckAt && Date.now() >= existing.context.recheckAt)) {
        let updated = this.parseClaudeSession(f.path, f.mtime, existing);
        if (updated) {
          updated = this.holdRunningAfterSend(updated, existing);
          updated.size = f.size;
          this.sessions.set(sessionId, updated);
          anyChanged = true;
        }
      }
    }

    return anyChanged;
  }

  parseClaudeSession(filePath, mtime, prevSession) {
    try {
      const stats = fs.statSync(filePath);
      const fd = fs.openSync(filePath, 'r');

      // 1. Read head (8KB) to get exact root project cwd
      const headSize = Math.min(stats.size, 8192);
      const headBuf = Buffer.alloc(headSize);
      fs.readSync(fd, headBuf, 0, headSize, 0);

      let rootCwd = null;
      const headLines = headBuf.toString('utf-8').split('\n');
      for (const hl of headLines) {
        if (!hl.trim()) continue;
        try {
          const ho = JSON.parse(hl);
          if (ho.cwd) {
            rootCwd = ho.cwd;
            break;
          }
        } catch (e) {}
      }

      fs.closeSync(fd);

      // 2. Read tail, growing past huge lines (base64 images, big tool results)
      //    until a real conversation event (assistant/user) is in view.
      const entries = this.readTailEntries(filePath, {
        initialBytes: 1048576,
        maxEntries: 80,
        isEnough: (es) => es.some(e => !e.isSidechain && (e.type === 'assistant' || e.type === 'user'))
      });

      let projectCwd = rootCwd;
      let aiTitle = '';
      for (const entry of entries) {
        if (!projectCwd && entry.cwd) projectCwd = entry.cwd;
        if (!aiTitle && entry.type === 'ai-title' && entry.aiTitle) aiTitle = entry.aiTitle;
        if (projectCwd && aiTitle) break;
      }

      if (entries.length === 0) return null;

      const finalCwd = rootCwd || projectCwd || os.homedir();
      let projectName = path.basename(finalCwd);
      if (!projectName || projectName === '.') {
        projectName = path.basename(path.dirname(filePath)).replace(/^c--Users-[^-]+-Desktop-/, '');
      }

      // Collect latest assistant text and tool_use across recent entries
      let latestAssistantText = '';
      let latestToolUse = null;
      let latestUserText = '';

      for (const e of entries) {
        if (e.type === 'assistant' && e.message?.content) {
          const contents = Array.isArray(e.message.content) ? e.message.content : [];
          if (!latestAssistantText) {
            const textBlocks = contents.filter(c => c.type === 'text' && c.text?.trim());
            if (textBlocks.length > 0) {
              latestAssistantText = textBlocks.map(t => t.text).join('\n\n').trim();
            }
          }
          if (!latestToolUse) {
            const tu = contents.find(c => c.type === 'tool_use');
            if (tu) latestToolUse = tu;
          }
        } else if ((e.type === 'user' || e.type === 'api-request-blob') && !latestUserText) {
          const contents = e.message?.content;
          if (typeof contents === 'string') {
            latestUserText = contents;
          } else if (Array.isArray(contents)) {
            const textBlock = contents.find(c => c.type === 'text' && c.text && !c.text.startsWith('<ide_'));
            if (textBlock) latestUserText = textBlock.text;
          }
        } else if (e.type === 'last-prompt' && e.lastPrompt && !latestUserText) {
          latestUserText = e.lastPrompt;
        }
      }

      // Model & reasoning effort of the main thread (newest entry that records them).
      // Assistant entries carry message.model + perTurnEffort/effort; api-request entries
      // carry params.model + params.output_config.effort (available before the first reply).
      let model = '';
      let effort = '';
      for (const e of entries) {
        if (e.isSidechain) continue;
        if (e.type === 'assistant' && e.message?.model && e.message.model !== '<synthetic>') {
          model = e.message.model;
          effort = e.perTurnEffort || e.effort || '';
          break;
        }
        if (e.type === 'api-request' && e.params?.model && e.params?.output_config?.effort) {
          model = e.params.model;
          effort = e.params.output_config.effort;
          break;
        }
      }
      if (!model && prevSession) {
        model = prevSession.model || '';
        effort = effort || prevSession.effort || '';
      }

      const context = this.readClaudeContext(entries, model, prevSession);

      // Determine turn state by finding the most recent lifecycle event in entries (entries[0] is newest)
      let turnState = 'idle'; // 'running' | 'idle'
      let activeSubState = 'thinking'; // 'thinking' | 'tool'
      let activeTool = null;

      // NOTE: bookkeeping entries (last-prompt, ai-title, mode, session-owner, atis-latch,
      // cost-state, queue-operation, tools-used, attachment...) are written MID-TURN right
      // after every api-request, so they must NOT be treated as end-of-turn markers.
      // Only real conversation events decide the state. Subagent (sidechain) entries are skipped.
      for (const e of entries) {
        if (e.isSidechain) continue;
        if (e.type === 'system' && (e.subtype === 'stop_hook_summary' || e.subtype === 'turn_duration')) {
          turnState = 'idle';
          break;
        }
        if (e.type === 'user' && this.isInterruptEntry(e)) {
          turnState = 'idle';
          break;
        }
        // A compaction finished: nothing is running until the next prompt
        if (e.type === 'system' && e.subtype === 'compact_boundary') {
          turnState = 'idle';
          break;
        }
        if (e.type === 'user') {
          // Compaction summary and meta notes are not prompts
          if (e.isCompactSummary || e.isMeta) continue;
          const raw = e.message?.content;
          const text = typeof raw === 'string' ? raw
            : (Array.isArray(raw) && raw[0]?.type === 'text' ? raw[0].text : '');
          // Local slash commands (/compact, /model, /clear…) answered without the model
          if (/^\s*<local-command-(stdout|stderr)>/.test(text)) {
            turnState = 'idle';
            break;
          }
          // The command line itself: let the entries around it decide
          if (/^\s*<command-name>/.test(text)) continue;
        }
        if (e.type === 'assistant') {
          const stopReason = e.message?.stop_reason;
          const contents = Array.isArray(e.message?.content) ? e.message.content : [];
          const tu = contents.find(c => c.type === 'tool_use');
          if (stopReason === 'end_turn') {
            turnState = 'idle';
            break;
          }
          if (stopReason === 'tool_use' || tu) {
            turnState = 'running';
            activeSubState = 'tool';
            activeTool = tu || latestToolUse;
            break;
          }
          // Streaming / thinking block
          turnState = 'running';
          activeSubState = 'thinking';
          break;
        }
        if (e.type === 'api-request' || e.type === 'user') {
          // A user prompt / tool_result was sent, or a model request is in flight
          turnState = 'running';
          activeSubState = 'thinking';
          break;
        }
      }
      if (context.compacting) {
        turnState = 'running';
        activeSubState = 'thinking';
      }

      const latestEntry = entries[0];
      const sessionUuid = path.basename(filePath, '.jsonl');
      // Time of the newest real conversation event (used to tell whether a
      // message sent from the HUD has reached the transcript yet)
      const lastTurnEntry = entries.find((e) => !e.isSidechain && (e.type === 'user' || e.type === 'assistant'));
      const lastTurnTs = Date.parse(lastTurnEntry?.timestamp) || 0;
      const sessionId = 'claude_' + sessionUuid;

      // What the current turn is doing, for the HUD's activity line:
      // when the prompt was sent and how many tool steps ran since.
      let turnStartTs = 0, turnSteps = 0;
      for (const e of entries) { // newest → oldest
        if (e.isSidechain) continue;
        if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
          turnSteps += e.message.content.filter((c) => c.type === 'tool_use').length;
        }
        if (e.type === 'user' && !e.isMeta && !e.isCompactSummary) {
          const c = e.message?.content;
          const isPrompt = typeof c === 'string'
            ? !/^\s*<(local-command|command-name)/.test(c)
            : Array.isArray(c) && c.some((b) => b.type === 'text') && !c.some((b) => b.type === 'tool_result');
          if (isPrompt) { turnStartTs = Date.parse(e.timestamp) || 0; break; }
        }
      }

      let status = turnState;
      let statusLabel = 'Idle (Ready)';
      let state = 'waiting';
      let title = aiTitle || 'Claude ready';
      let activity = null;      // { kind: 'tool'|'thinking', tool, input, since, steps }
      let placeholder = false;  // fullContent is a stand-in, not a real reply
      let detail = latestAssistantText || latestUserText || 'Session ready';
      let fullContent = latestAssistantText || latestUserText || '*(Session ready)*';
      let isQuestion = false;

      // Tools that mean "Claude is waiting for YOU": a question with options,
      // or a plan to approve. The turn is technically running (tool pending),
      // but for the HUD that's "needs input".
      const waitingTool = status === 'running' && activeSubState === 'tool' && activeTool &&
        ['AskUserQuestion', 'ExitPlanMode'].includes(activeTool.name);

      if (waitingTool) {
        status = 'idle';
        state = 'attention';
        isQuestion = true;
        const input = activeTool.input || {};
        if (activeTool.name === 'ExitPlanMode') {
          statusLabel = 'Idle (Plan ready)';
          title = aiTitle ? `${aiTitle} — Plan ready` : 'Claude has a plan ready';
          detail = 'Plan ready for your approval';
          fullContent = `**Plan ready for your approval**\n\n${input.plan || ''}`;
        } else {
          const qs = Array.isArray(input.questions) ? input.questions : [];
          statusLabel = 'Idle (Question)';
          title = aiTitle ? `${aiTitle} — Question` : 'Claude asked a question!';
          detail = qs.map((q) => q.question).filter(Boolean).join(' · ') || 'Claude has a question for you';
          fullContent = (latestAssistantText ? latestAssistantText + '\n\n' : '') + qs.map((q) => {
            const opts = Array.isArray(q.options)
              ? q.options.map((o) => `- **${o.label || o}**${o.description ? ` — ${o.description}` : ''}`).join('\n')
              : '';
            return `**${q.question || ''}**${opts ? '\n\n' + opts : ''}`;
          }).join('\n\n') + '\n\n*Answer in Claude Code, or type your answer here.*';
        }
      } else if (status === 'running') {
        if (activeSubState === 'tool' && activeTool) {
          const toolName = activeTool.name || 'Tool';
          statusLabel = `Running: ${toolName}`;
          state = 'tool';
          title = `Running ${toolName}`;
          const toolInput = activeTool.input?.command || activeTool.input?.file_path || activeTool.input?.pattern || '';
          detail = toolInput || latestAssistantText || `Executing ${toolName}...`;
          activity = { kind: 'tool', tool: toolName, input: activeTool.input || {}, since: turnStartTs, steps: turnSteps };
          if (!latestAssistantText) {
            placeholder = true;
            fullContent = `**Executing Tool: \`${toolName}\`**\n\n` +
              (activeTool.input?.command
                ? `\`\`\`bash\n${activeTool.input.command}\n\`\`\``
                : `\`\`\`json\n${JSON.stringify(activeTool.input || {}, null, 2)}\n\`\`\``);
          }
        } else {
          statusLabel = 'Running (Thinking...)';
          state = 'thinking';
          title = 'Claude is thinking...';
          detail = latestUserText || latestAssistantText || 'Processing request...';
          activity = { kind: 'thinking', since: turnStartTs, steps: turnSteps };
          if (!latestAssistantText && latestUserText) {
            placeholder = true;
            fullContent = `> ${latestUserText}\n\n*Claude is thinking...*`;
          }
        }
      } else {
        // Idle
        const lower = (latestAssistantText || '').toLowerCase();
        if (endsWithQuestion(latestAssistantText)) {
          isQuestion = true;
          statusLabel = 'Idle (Question)';
          state = 'attention';
          title = aiTitle ? `${aiTitle} — Question` : 'Claude asked a question!';
        } else {
          statusLabel = 'Idle (Ready)';
          state = 'waiting';
          title = aiTitle || 'Claude ready';
        }
      }

      const recordId = `${latestEntry.uuid || latestEntry.timestamp || stats.size}_${status}_${statusLabel}`;
      const alertKey = sessionId + '_' + recordId;
      const isUnread = state === 'attention' && !this.dismissedAlerts.has(alertKey);

      const sessionObj = {
        id: sessionId,
        sessionUuid,
        filePath, // transcript, so the HUD can load older messages
        source: 'claude',
        project: projectName,
        aiTitle,
        sessionTitle: aiTitle || this.formatTitle(latestUserText) || prevSession?.sessionTitle || '',
        model,
        effort,
        context,
        activity,
        placeholder,
        lastTurnTs,
        cwd: finalCwd,
        status, // 'running' | 'idle'
        statusLabel, // e.g. "Running: Bash" or "Idle (Ready)"
        state,
        title,
        detail: this.formatDetail(detail),
        fullContent: fullContent || detail,
        isQuestion,
        mtime,
        lastRecordId: recordId,
        unread: isUnread,
        timestamp: new Date(mtime).toISOString()
      };

      if (isUnread && (!prevSession || prevSession.lastRecordId !== recordId || prevSession.state !== 'attention')) {
        this.emit('alert', sessionObj);
      }

      return sessionObj;
    } catch (err) {
      return null;
    }
  }

  // -------------------------------------------------------------
  // Antigravity Multi-Session Scanner
  // -------------------------------------------------------------
  // Antigravity keeps each conversation in two places:
  //   brain/<id>/.system_generated/logs/transcript.jsonl  (readable log — but newer
  //     builds can STOP updating it mid-conversation)
  //   conversations/<id>.db  (SQLite, always current; `steps` table)
  // We read the transcript when it's current, and fall back to the database's
  // latest step when the database is newer than the transcript.
  decodeFileUri(uri) {
    if (!uri || typeof uri !== 'string') return '';
    try {
      let s = uri.trim().replace(/^file:\/\//i, '');
      s = decodeURIComponent(s);
      if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(s)) s = s.slice(1);
      return path.normalize(s);
    } catch (e) {
      return '';
    }
  }

  readAgSummaries(summaryDbPath) {
    const DatabaseSync = this.getSqlite();
    if (!DatabaseSync || !summaryDbPath || !fs.existsSync(summaryDbPath)) return new Map();
    let mtime = 0;
    try {
      mtime = fs.statSync(summaryDbPath).mtimeMs;
      const wal = fs.statSync(summaryDbPath + '-wal');
      if (wal.size > 0) mtime = Math.max(mtime, wal.mtimeMs);
    } catch (e) {}
    const cached = this.agSummaryCache.get(summaryDbPath);
    if (cached && cached.mtime === mtime) return cached.byId;

    const byId = new Map();
    let db;
    try {
      db = new DatabaseSync(summaryDbPath, { readOnly: true });
      const rows = db.prepare(
        'SELECT conversation_id, title, preview, workspace_uris, status, parent_conversation_id, nesting_depth FROM conversation_summaries'
      ).all();
      for (const r of rows) {
        if (!r || !r.conversation_id) continue;
        let cwd = '';
        if (r.workspace_uris) {
          try {
            const arr = JSON.parse(r.workspace_uris);
            if (Array.isArray(arr) && arr[0]) cwd = this.decodeFileUri(arr[0]);
          } catch (e) {}
        }
        byId.set(String(r.conversation_id), {
          title: typeof r.title === 'string' ? r.title.trim() : '',
          preview: typeof r.preview === 'string' ? r.preview.trim() : '',
          cwd,
          status: r.status || '',
          isSubagent: (Number(r.nesting_depth) > 0) || Boolean(r.parent_conversation_id && String(r.parent_conversation_id).trim()),
        });
      }
      this.agSummaryCache.set(summaryDbPath, { mtime, byId });
    } catch (e) {
      return cached ? cached.byId : byId;
    } finally {
      try { db && db.close(); } catch (e) {}
    }
    return byId;
  }

  parseAgModelEffort(rawModel) {
    if (!rawModel || typeof rawModel !== 'string') return { model: '', effort: '' };
    const s = rawModel.trim();
    if (!s || /^none$/i.test(s)) return { model: '', effort: '' };
    // Display name like "Gemini 4 Argon (Medium)" or "Claude Opus 5.5 (High)"
    const paren = s.match(/^(.*?)\s*\((Low|Medium|High|XHigh|Max|Thinking)\)\s*$/i);
    if (paren) {
      const mName = paren[1].trim();
      const eff = paren[2].toLowerCase();
      return { model: mName, effort: eff === 'thinking' ? 'high' : eff };
    }
    // Slug like "gemini-4-argon-medium" or "claude-opus-5-5-high"
    const slug = s.match(/^(.*?)-(low|medium|high|xhigh|max)$/i);
    if (slug) {
      return { model: s, effort: slug[2].toLowerCase() };
    }
    return { model: s, effort: '' };
  }

  unwrapAgArg(val) {
    if (typeof val !== 'string') return val;
    const t = val.trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try { return JSON.parse(t); } catch (e) { return t.slice(1, -1); }
    }
    return val;
  }

  unwrapAgArgsObj(args) {
    if (!args || typeof args !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      out[k] = this.unwrapAgArg(v);
    }
    return out;
  }

  checkAntigravitySessions() {
    const cutoff = Date.now() - (48 * 60 * 60 * 1000);
    const byId = new Map(); // convId -> { convId, appDataDir, transcriptPath, tMtime, tSize, dbPath, dbMtime, summary }

    for (const root of this.antigravityRoots) {
      const hasBrain = fs.existsSync(root.brainDir);
      const hasConv = fs.existsSync(root.convDir);
      if (!hasBrain && !hasConv) continue;

      const summaries = this.readAgSummaries(root.summaryDb);

      const entry = (id) => {
        if (!byId.has(id)) {
          byId.set(id, {
            convId: id,
            appDataDir: root.appDataDir,
            transcriptPath: null,
            tMtime: 0,
            tSize: 0,
            dbPath: null,
            dbMtime: 0,
            summary: summaries.get(id) || null,
          });
        }
        const cur = byId.get(id);
        if (!cur.summary && summaries.has(id)) cur.summary = summaries.get(id);
        return cur;
      };

      if (hasBrain) {
        try {
          for (const d of fs.readdirSync(root.brainDir, { withFileTypes: true })) {
            if (!d.isDirectory()) continue;
            const p = path.join(root.brainDir, d.name, '.system_generated', 'logs', 'transcript.jsonl');
            try {
              const st = fs.statSync(p);
              const e = entry(d.name);
              if (st.mtimeMs >= e.tMtime) {
                e.transcriptPath = p; e.tMtime = st.mtimeMs; e.tSize = st.size; e.appDataDir = root.appDataDir;
              }
            } catch (err) {}
          }
        } catch (e) {}
      }

      if (hasConv) {
        try {
          for (const name of fs.readdirSync(root.convDir)) {
            if (!name.endsWith('.db')) continue;
            const p = path.join(root.convDir, name);
            let m = 0;
            try { m = fs.statSync(p).mtimeMs; } catch (err) { continue; }
            // WAL mode: pending writes live in <db>-wal. Only count it when it actually
            // holds data — opening the DB (even just to read) can touch an empty WAL file.
            try {
              const w = fs.statSync(p + '-wal');
              if (w.size > 0) m = Math.max(m, w.mtimeMs);
            } catch (err) {}
            const e = entry(name.slice(0, -3));
            if (m >= e.dbMtime) {
              e.dbPath = p; e.dbMtime = m; e.appDataDir = root.appDataDir;
            }
          }
        } catch (e) {}
      }
    }

    const found = [...byId.values()]
      .filter((f) => !(f.summary && f.summary.isSubagent))
      .map((f) => ({ ...f, activity: Math.max(f.tMtime, f.dbMtime) }))
      .filter((f) => f.activity > cutoff)
      .sort((a, b) => b.activity - a.activity)
      .slice(0, 10);

    let anyChanged = false;
    for (const f of found) {
      const sessionId = 'antigravity_' + f.convId;
      const existing = this.sessions.get(sessionId);
      const sumTitle = f.summary?.title || '';
      const sumCwd = f.summary?.cwd || '';
      const sig = `${f.tMtime}|${f.tSize}|${f.dbMtime}|${sumTitle}|${sumCwd}`;
      // DB-based status depends on "quiet time", so keep re-checking a running
      // session for a minute after the last write even if nothing changed.
      const quietRecheck = existing?.dbBased && existing.status === 'running' && Date.now() - f.dbMtime < 60000;
      if (existing && existing.sig === sig && !quietRecheck && !this.holdExpired(existing)) continue;

      let updated = f.transcriptPath ? this.parseAntigravitySession(f.transcriptPath, f.convId, f.tMtime, existing, f) : null;
      const transcriptStale = f.dbPath && f.dbMtime > f.tMtime + 5000;
      if (transcriptStale || !updated) {
        updated = this.applyAntigravityDb(updated, f, existing) || updated;
      }
      if (!updated) continue;

      updated = this.holdRunningAfterSend(updated, existing);
      updated.sig = sig;
      updated.size = f.tSize;
      updated.mtime = f.activity;
      // Process ended → stay idle until the files change again
      const ended = this.endedTurns?.get(sessionId);
      if (ended) {
        if (!ended.appliedSig) ended.appliedSig = sig;
        updated = this.applyEndedTurn(sessionId, updated);
      }
      if (!existing || existing.sig !== sig || existing.status !== updated.status ||
          existing.statusLabel !== updated.statusLabel || existing.state !== updated.state) {
        anyChanged = true;
      }
      this.sessions.set(sessionId, updated);
    }

    return anyChanged;
  }

  // ---- Antigravity SQLite fallback ----
  // steps(idx, step_type INT, status INT, step_payload BLOB, …): `idx` is the same
  // step_index the transcript uses, but type/status are numeric enums. We learn
  // the numbers' names by matching rows against steps also present in a transcript.
  getSqlite() {
    if (this._sqlite === undefined) {
      try { this._sqlite = require('node:sqlite').DatabaseSync; } catch (e) { this._sqlite = null; }
    }
    return this._sqlite;
  }

  learnAntigravityEnums(db, transcriptPath) {
    this.agTypeNames = this.agTypeNames || new Map();
    this.agStatusNames = this.agStatusNames || new Map();
    const types = [...this.agTypeNames.values()];
    if (types.includes('PLANNER_RESPONSE') && types.includes('USER_INPUT') && this.agStatusNames.size >= 2) return;
    if (!transcriptPath) return;
    try {
      const byIdx = new Map();
      for (const line of fs.readFileSync(transcriptPath, 'utf-8').split('\n')) {
        const m = line.match(/^\{"step_index":(\d+),"source":"[A-Z_]+","type":"([A-Z_]+)","status":"([A-Z_]+)"/);
        if (m) byIdx.set(Number(m[1]), { type: m[2], status: m[3] });
      }
      if (!byIdx.size) return;
      const rows = db.prepare('SELECT idx, step_type, status FROM steps WHERE idx <= ?').all(Math.max(...byIdx.keys()));
      for (const r of rows) {
        const t = byIdx.get(Number(r.idx));
        if (!t) continue;
        if (!this.agTypeNames.has(r.step_type)) this.agTypeNames.set(r.step_type, t.type);
        if (!this.agStatusNames.has(r.status)) this.agStatusNames.set(r.status, t.status);
      }
    } catch (e) {}
  }

  // Longest readable text run inside a protobuf blob (the message text)
  // Newest real reply (PLANNER_RESPONSE with written content — not thinking,
  // not a tool call) from Antigravity's readable transcript.
  latestAgReply(transcriptPath) {
    if (!transcriptPath) return null;
    try {
      const isReply = (e) => e.type === 'PLANNER_RESPONSE' && typeof e.content === 'string' && e.content.trim();
      const entries = this.readTailEntries(transcriptPath, {
        initialBytes: 262144,
        maxEntries: 400,
        isEnough: (es) => es.some(isReply) && es.some((e) => e.type === 'USER_INPUT'),
      });
      const r = entries.find(isReply);
      const u = entries.find((e) => e.type === 'USER_INPUT');
      if (!r) return null;
      return {
        text: r.content.trim(),
        step: r.step_index ?? -1,
        userStep: u ? (u.step_index ?? -1) : -1,
        ts: Date.parse(r.created_at) || 0,
      };
    } catch (e) { return null; }
  }

  extractBlobText(blob) {
    if (!blob) return '';
    try {
      const s = new TextDecoder('utf-8', { fatal: false }).decode(blob);
      const runs = s.match(/[^\u0000-\u0008\u000b\u000c\u000e-\u001f�]{30,}/g) || [];
      let best = runs.sort((a, b) => b.length - a.length)[0] || '';
      const req = best.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      if (req) best = req[1];
      best = best.replace(/\d?\(?bot-[0-9a-f]{8}-[0-9a-f-]{27,}\)?/gi, ''); // internal ids, not text
      return best.replace(/^[^\p{L}\p{N}#*>\-`]+/u, '').trim().slice(0, 4000);
    } catch (e) { return ''; }
  }

  readAntigravityDb(dbPath, transcriptPath) {
    const DatabaseSync = this.getSqlite();
    if (!DatabaseSync || !dbPath) return null;
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      this.learnAntigravityEnums(db, transcriptPath);
      const last = db.prepare('SELECT idx, step_type, status FROM steps ORDER BY idx DESC LIMIT 1').get();
      if (!last) return null;
      const typeInt = (name) => [...this.agTypeNames].find(([, v]) => v === name)?.[0];
      const newestOf = (name) => {
        const t = typeInt(name);
        if (t === undefined) return null;
        return db.prepare('SELECT idx, step_payload FROM steps WHERE step_type = ? ORDER BY idx DESC LIMIT 1').get(t);
      };
      const planner = newestOf('PLANNER_RESPONSE');
      const user = newestOf('USER_INPUT');

      // Extract workspace URI from trajectory_metadata_blob if needed
      let dbCwd = '';
      try {
        const meta = db.prepare('SELECT data FROM trajectory_metadata_blob LIMIT 1').get();
        if (meta?.data) {
          const decoded = new TextDecoder('utf-8', { fatal: false }).decode(meta.data);
          const uriMatch = decoded.match(/file:\/\/\/[^\u0000-\u0020"']+/);
          if (uriMatch) dbCwd = this.decodeFileUri(uriMatch[0]);
        }
      } catch (e) {}

      // Extract model from newest gen_metadata row
      let dbModel = '';
      try {
        const gm = db.prepare('SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1').get();
        if (gm?.data) {
          const decoded = new TextDecoder('utf-8', { fatal: false }).decode(gm.data);
          const mMatch = decoded.match(/(Gemini\s+[\w.\s-]+?\((?:Low|Medium|High|XHigh|Max|Thinking)\)|Claude\s+[\w.\s-]+?\((?:Low|Medium|High|XHigh|Max|Thinking)\)|GPT-OSS[\w.\s-]+?\((?:Low|Medium|High|XHigh|Max)\)|gemini-[a-z0-9.-]+|claude-[a-z0-9.-]+|gpt-oss-[a-z0-9.-]+)/i);
          if (mMatch) dbModel = mMatch[1].trim();
        }
      } catch (e) {}

      return {
        lastIdx: Number(last.idx),
        lastType: this.agTypeNames.get(last.step_type) || 'UNKNOWN',
        lastStatus: this.agStatusNames.get(last.status) || 'UNKNOWN',
        plannerIdx: planner ? Number(planner.idx) : -1,
        userIdx: user ? Number(user.idx) : -1,
        text: planner ? this.extractBlobText(planner.step_payload) : '',
        userText: user ? this.extractBlobText(user.step_payload) : '',
        cwd: dbCwd,
        model: dbModel,
      };
    } catch (e) {
      return null; // locked / schema changed → caller falls back
    } finally {
      try { db && db.close(); } catch (e) {}
    }
  }

  applyAntigravityDb(base, f, prev) {
    const quiet = Date.now() - f.dbMtime;
    const info = this.readAntigravityDb(f.dbPath, f.transcriptPath);
    const sessionId = 'antigravity_' + f.convId;

    let status, statusLabel, state, title, detail, fullContent, isQuestion = false;
    let agActivity = null;
    if (!info) {
      // No SQLite access: judge by database activity only
      status = quiet < 20000 ? 'running' : 'idle';
      statusLabel = status === 'running' ? 'Running (Thinking...)' : 'Idle (Ready)';
      state = status === 'running' ? 'thinking' : 'waiting';
      title = status === 'running' ? 'Antigravity is working…' : 'Antigravity ready';
      detail = base?.detail || '';
      fullContent = base?.fullContent || '*(Open Antigravity to read the latest reply)*';
    } else {
      const t = info.lastType;
      const text = info.text;
      // Last step finished (a tool result / system note), then nothing for
      // AG_INTERRUPTED_MS → the run was cut off (e.g. the HUD's agy was closed)
      const interrupted = info.lastStatus !== 'RUNNING' && quiet > AG_INTERRUPTED_MS &&
        ['GENERIC', 'SYSTEM_MESSAGE', 'CHECKPOINT', 'USER_INPUT'].includes(t);
      if (t === 'ERROR_MESSAGE') {
        status = 'idle'; statusLabel = 'Idle (Error)'; state = 'waiting';
        title = 'Antigravity stopped with an error';
      } else if (interrupted) {
        status = 'idle'; statusLabel = 'Idle (Interrupted)'; state = 'waiting';
        title = 'Antigravity stopped before finishing';
      } else if (info.lastStatus === 'RUNNING') {
        status = 'running'; statusLabel = 'Running: tool'; state = 'tool'; title = 'Antigravity running a tool';
      } else if (t === 'USER_INPUT' || t === 'GENERIC' || t === 'SYSTEM_MESSAGE' || t === 'CHECKPOINT' || info.userIdx > info.plannerIdx) {
        status = 'running'; statusLabel = 'Running (Thinking...)'; state = 'thinking'; title = 'Antigravity is thinking...';
      } else if (t === 'PLANNER_RESPONSE') {
        // A reply step that's been quiet a few seconds = turn finished
        if (quiet > 6000) {
          status = 'idle'; statusLabel = 'Idle (Ready)'; state = 'waiting'; title = 'Antigravity ready';
        } else {
          status = 'running'; statusLabel = 'Running (Generating...)'; state = 'thinking'; title = 'Antigravity generating response...';
        }
      } else {
        status = quiet > 20000 ? 'idle' : 'running';
        statusLabel = status === 'running' ? 'Running (Thinking...)' : 'Idle (Ready)';
        state = status === 'running' ? 'thinking' : 'waiting';
        title = status === 'running' ? 'Antigravity is working…' : 'Antigravity ready';
      }
      // The database blob of a step that only thought + called a tool holds the
      // *thinking* — never show that as a reply. The transcript has the real text.
      const reply = this.latestAgReply(f.transcriptPath);
      const replyIsCurrent = reply && reply.step >= reply.userStep;
      const replyText = replyIsCurrent ? reply.text : (reply ? '' : text);
      if (status === 'idle' && replyText) {
        if (endsWithQuestion(replyText)) {
          isQuestion = true; statusLabel = 'Idle (Question)'; state = 'attention'; title = 'Antigravity asked a question!';
        }
      }
      detail = status === 'running' ? (info.userText || replyText) : replyText;
      fullContent = status === 'running'
        ? '*Antigravity is working on it…*' // progress goes on the activity line, not in the chat
        : statusLabel === 'Idle (Interrupted)'
          ? INTERRUPTED_NOTE
          : (replyText || '*(Antigravity finished without a written reply — open Antigravity to see what it did)*');
      agActivity = status === 'running'
        ? (state === 'tool' ? { kind: 'tool', tool: 'a tool', input: {} } : { kind: 'thinking' })
        : null;
    }

    const resolvedCwd = f.summary?.cwd || base?.cwd || info?.cwd || prev?.cwd || process.cwd();
    const resolvedProject = (resolvedCwd && resolvedCwd !== process.cwd())
      ? path.basename(resolvedCwd)
      : (base?.project && base.project !== 'Antigravity' ? base.project : (f.summary?.cwd ? path.basename(f.summary.cwd) : 'Antigravity'));
    const parsedModel = this.parseAgModelEffort(base?.model || info?.model || prev?.model || '');
    const model = parsedModel.model || base?.model || prev?.model || '';
    const effort = base?.effort || parsedModel.effort || prev?.effort || '';
    const aiTitle = f.summary?.title || base?.aiTitle || prev?.aiTitle || '';
    const sessionTitle = aiTitle || base?.sessionTitle || this.formatTitle(info?.userText || f.summary?.preview || '') || prev?.sessionTitle || '';

    const recordId = `db_${info ? info.lastIdx : Math.round(f.dbMtime)}_${status}_${statusLabel}`;
    const alertKey = sessionId + '_' + recordId;
    const isUnread = state === 'attention' && !this.dismissedAlerts.has(alertKey);
    const sessionObj = {
      id: sessionId,
      sessionUuid: f.convId,
      appDataDir: f.appDataDir || base?.appDataDir || prev?.appDataDir || 'antigravity',
      filePath: f.transcriptPath || base?.filePath || null,
      dbPath: f.dbPath || base?.dbPath || null,
      source: 'antigravity',
      project: resolvedProject,
      aiTitle,
      sessionTitle,
      model,
      effort,
      context: base?.context || prev?.context || null,
      lastTurnTs: f.dbMtime,
      cwd: resolvedCwd,
      status,
      statusLabel,
      state,
      title,
      detail: this.formatDetail(detail),
      fullContent,
      placeholder: status === 'running', // nothing real to show yet (see syncLiveMessage)
      activity: agActivity,
      pendingQuestion: status === 'idle' ? (base?.pendingQuestion || null) : null,
      isQuestion,
      mtime: f.dbMtime,
      lastRecordId: recordId,
      unread: isUnread,
      dbBased: true,
      timestamp: new Date(f.dbMtime).toISOString(),
    };
    if (isUnread && (!prev || prev.lastRecordId !== recordId || prev.state !== 'attention')) {
      this.emit('alert', sessionObj);
    }
    return sessionObj;
  }

  parseAntigravitySession(filePath, convId, mtime, prevSession, fMeta = null) {
    try {
      // Entries newest → oldest. Keep reading further back until we have the latest
      // PLANNER_RESPONSE / USER_INPUT (a single huge read_file result line can exceed 256KB).
      const entries = this.readTailEntries(filePath, {
        initialBytes: 262144,
        maxEntries: 120,
        isEnough: (es) => es.some(e => e.type === 'PLANNER_RESPONSE' || e.type === 'USER_INPUT')
      });

      if (entries.length === 0) return null;

      const latestEntry = entries[0];
      const latestUserInput = entries.find(e => e.type === 'USER_INPUT');
      const latestPlanner = entries.find(e => e.type === 'PLANNER_RESPONSE');

      const userStep = latestUserInput ? (latestUserInput.step_index ?? -1) : -1;
      const plannerStep = latestPlanner ? (latestPlanner.step_index ?? -1) : -1;

      // Detect Project Name & CWD from summary DB, workspace metadata, or document paths in transcript entries
      let projectCwd = fMeta?.summary?.cwd || '';
      let rawModel = '';
      for (const e of entries) {
        const contentStr = typeof e.content === 'string' ? e.content : '';
        if (!rawModel && contentStr.includes('Model Selection')) {
          const m = contentStr.match(/changed setting `Model Selection` from [^\r\n]+? to ([^\r\n]+?)\.?$/im) ||
                    contentStr.match(/changed setting `Model Selection` from [^\r\n]+? to ([^\r\n]+)/i);
          if (m && m[1]) {
            const cleaned = m[1].trim().replace(/\.\s[\s\S]*$/, '').replace(/\.$/, '');
            if (!/^none$/i.test(cleaned)) rawModel = cleaned;
          }
        }
        if (!projectCwd) {
          const wsMatch = contentStr.match(/Active Workspaces:\s*\r?\n-\s*([a-zA-Z]:\\[^\r\n]+|\/[^\r\n]+)/);
          if (wsMatch) {
            projectCwd = wsMatch[1].trim();
          }
        }
        if (!projectCwd) {
          const cwdMatch = contentStr.match(/Command Working Directory:\s*([a-zA-Z]:\\[^\r\n]+|\/[^\r\n]+)/);
          if (cwdMatch) {
            projectCwd = cwdMatch[1].trim();
          }
        }
        if (!projectCwd) {
          const docMatch = contentStr.match(/Active Document:\s*([a-zA-Z]:\\[^\r\n(]+|\/[^\r\n(]+)/);
          if (docMatch) {
            projectCwd = path.dirname(docMatch[1].trim());
          }
        }
        if (!projectCwd) {
          const otherDocMatch = contentStr.match(/Other open documents:\s*\r?\n-\s*([a-zA-Z]:\\[^\r\n(]+|\/[^\r\n(]+)/);
          if (otherDocMatch) {
            projectCwd = path.dirname(otherDocMatch[1].trim());
          }
        }
      }

      // If still missing CWD or model, check head of transcript or SQLite DB
      if ((!projectCwd || !rawModel) && filePath) {
        try {
          const fd = fs.openSync(filePath, 'r');
          const headBuf = Buffer.alloc(16384);
          const bytes = fs.readSync(fd, headBuf, 0, 16384, 0);
          fs.closeSync(fd);
          const headStr = headBuf.toString('utf-8', 0, bytes);
          if (!projectCwd) {
            const ws = headStr.match(/Active Workspaces:\\n-\s*([a-zA-Z]:\\\\[^\\"\r\n]+|\/[^\\"\r\n]+)/);
            if (ws) projectCwd = ws[1].replace(/\\\\/g, '\\').trim();
          }
          if (!projectCwd) {
            const cw = headStr.match(/Command Working Directory:\s*([a-zA-Z]:\\\\[^\\"\r\n]+|\/[^\\"\r\n]+)/);
            if (cw) projectCwd = cw[1].replace(/\\\\/g, '\\').trim();
          }
          if (!rawModel) {
            const ms = headStr.match(/changed setting `Model Selection` from [^\\"\r\n]+? to ([^\\"\r\n]+?)\.?\\r?\\n/i) ||
                       headStr.match(/changed setting `Model Selection` from [^\\"\r\n]+? to ([^\\"\r\n]+)/i);
            if (ms && ms[1]) {
              const cleaned = ms[1].trim().replace(/\.\s[\s\S]*$/, '').replace(/\.$/, '');
              if (!/^none$/i.test(cleaned)) rawModel = cleaned;
            }
          }
        } catch (e) {}
      }

      if ((!projectCwd || !rawModel) && fMeta?.dbPath && (!prevSession?.cwd || !prevSession?.model)) {
        const dbInfo = this.readAntigravityDb(fMeta.dbPath, filePath);
        if (!projectCwd && dbInfo?.cwd) projectCwd = dbInfo.cwd;
        if (!rawModel && dbInfo?.model) rawModel = dbInfo.model;
      }

      if (!projectCwd) projectCwd = prevSession?.cwd || process.cwd();
      const projectName = (projectCwd && projectCwd !== process.cwd())
        ? path.basename(projectCwd)
        : (prevSession?.project && prevSession.project !== 'Antigravity' ? prevSession.project : (projectCwd ? path.basename(projectCwd) : 'Antigravity'));

      const parsedModel = this.parseAgModelEffort(rawModel || prevSession?.model || '');
      const model = parsedModel.model || prevSession?.model || '';
      const effort = parsedModel.effort || prevSession?.effort || '';

      // Compute context usage from newest PLANNER_RESPONSE with token metrics
      const tokenEntry = entries.find(e => e.type === 'PLANNER_RESPONSE' && ((e.input_tokens || 0) + (e.output_tokens || 0) > 0));
      let context = prevSession?.context || null;
      if (tokenEntry) {
        const used = (tokenEntry.input_tokens || 0) + (tokenEntry.cache_read_tokens || 0) + (tokenEntry.output_tokens || 0);
        const isGemini = !model || /gemini/i.test(model) || used > 200000;
        const window = isGemini ? 1000000 : 200000;
        context = {
          used,
          window,
          pct: window ? Math.min(100, (used / window) * 100) : 0,
          compacting: false,
          lastCompact: null,
          recheckAt: 0,
        };
      }

      // Helper to clean user request prompt
      const cleanPrompt = (txt) => {
        if (!txt) return '';
        const m = txt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (m) return m[1].trim();
        return txt.split('\n')[0].trim();
      };

      let status = 'idle'; // 'running' | 'idle'
      let statusLabel = 'Idle';
      let state = 'waiting';
      let title = 'Antigravity ready';
      let detail = '';
      let fullContent = '';
      let isQuestion = false;
      let pendingQuestion = null;

      const latestStep = latestEntry.step_index ?? -1;

      // 0a. Agent run ended with an error (e.g. model/quota failure) -> IDLE
      if (latestEntry.type === 'ERROR_MESSAGE') {
        status = 'idle';
        statusLabel = 'Idle (Error)';
        state = 'waiting';
        title = 'Antigravity stopped with an error';
        detail = typeof latestEntry.content === 'string' ? latestEntry.content : 'The agent run ended with an error';
        fullContent = `**Antigravity stopped with an error**\n\n${detail}`;
      }
      // 0b. System woke the agent (e.g. background command finished) after its last reply -> RUNNING
      else if (latestEntry.type === 'SYSTEM_MESSAGE' && latestStep > plannerStep && userStep < latestStep) {
        status = 'running';
        statusLabel = 'Running (Thinking...)';
        state = 'thinking';
        title = 'Antigravity is thinking...';
        detail = 'Processing a system update...';
        fullContent = '*Antigravity received a system update and is continuing...*';
      }
      // 1. User prompted and no PLANNER_RESPONSE logged yet -> RUNNING (Thinking)
      else if (userStep > plannerStep) {
        status = 'running';
        statusLabel = 'Running (Thinking...)';
        state = 'thinking';
        title = 'Antigravity is thinking...';
        const rawPrompt = cleanPrompt(latestUserInput?.content);
        detail = rawPrompt || 'User sent a prompt';
        fullContent = `> ${detail}\n\n*Antigravity is analyzing your request and formulating a plan...*`;
      }
      // 2. Planner has responded after or at the latest user input
      else if (latestPlanner) {
        const toolCalls = latestPlanner.tool_calls || [];
        const askQuestionCall = toolCalls.find(tc => tc.name === 'ask_question');
        const askDone = askQuestionCall && latestEntry.step_index > plannerStep &&
          (latestEntry.type === 'GENERIC' || latestEntry.type === 'USER_INPUT');

        if (askQuestionCall && !askDone) {
          // Waiting for user clarification
          status = 'idle';
          statusLabel = 'Idle (Question)';
          state = 'attention';
          isQuestion = true;
          title = 'Antigravity asking question!';
          let questions = askQuestionCall.args?.questions || [];
          if (typeof questions === 'string') {
            try { questions = JSON.parse(questions); } catch (e) { questions = []; }
          }
          if (Array.isArray(questions) && questions.length > 0) {
            pendingQuestion = {
              id: `ag_ask_${convId}_${plannerStep}`,
              questions: questions.map((q) => ({
                question: q.question || '',
                header: q.header || '',
                multiSelect: !!(q.is_multi_select || q.multiSelect),
                options: Array.isArray(q.options)
                  ? q.options.map((o) => (typeof o === 'string' ? { label: o, description: '' } : { label: o?.label || String(o), description: o?.description || '' }))
                  : [],
              })),
            };
          }
          detail = (Array.isArray(questions) ? questions.map(q => q.question).join('\n') : '') || 'Please provide your input';
          fullContent = `### Antigravity Question\n\n${detail}\n\n` + 
            (Array.isArray(questions) ? questions.map(q => Array.isArray(q.options) ? `**Options:**\n${q.options.map(o => `- ${typeof o === 'string' ? o : o?.label}`).join('\n')}` : '').join('\n') : '');
        } else if (toolCalls.length > 0) {
          // Agent called tools -> ALWAYS RUNNING until final text response
          status = 'running';
          const firstTool = toolCalls[0];
          const toolName = firstTool.name || 'tool';
          const cleanArgs = this.unwrapAgArgsObj(firstTool.args);

          // Check if tool finished output (GENERIC step after planner)
          const isToolDone = latestEntry.step_index > plannerStep && latestEntry.type === 'GENERIC';
          const toolErrText = isToolDone && latestEntry.status === 'ERROR'
            ? String(latestEntry.error || latestEntry.content || '')
            : '';
          const isCmdDenied = /user denied permission to run command:/i.test(toolErrText);
          const entryTs = Date.parse(latestEntry.created_at) || mtime;

          if (isToolDone && isCmdDenied && (Date.now() - entryTs > 3000)) {
            status = 'idle';
            statusLabel = 'Idle (Command needs approval)';
            state = 'waiting';
            title = 'Command requires approval';
            detail = cleanArgs.CommandLine || toolErrText;
            fullContent = `**Command requires approval (\`${toolName}\`)**\n\n\`\`\`\n${toolErrText.slice(0, 600)}\n\`\`\``;
          } else if (isToolDone) {
            statusLabel = `Running (Analyzing ${toolName})`;
            state = 'thinking';
            title = `Antigravity running...`;
            detail = `Finished ${toolName}, analyzing output...`;
            fullContent = `**Tool Output Received: \`${toolName}\`**\n\n` +
              (typeof latestEntry.content === 'string' ? `\`\`\`\n${latestEntry.content.slice(0, 800)}\n\`\`\`\n\n` : '') +
              `*Antigravity is analyzing the output and planning next actions...*`;
          } else {
            statusLabel = `Running: ${toolName}`;
            state = 'tool';
            title = `Running ${toolName}`;
            detail = cleanArgs.toolSummary || cleanArgs.CommandLine || cleanArgs.Path || cleanArgs.TargetFile || cleanArgs.Query || '';
            fullContent = `**Executing Tool: \`${toolName}\`**\n\n` +
              (cleanArgs.CommandLine ? `\`\`\`powershell\n${cleanArgs.CommandLine}\n\`\`\`` : `\`\`\`json\n${JSON.stringify(cleanArgs, null, 2)}\n\`\`\``);
          }
        } else {
          // No tool calls in planner response
          if (latestPlanner.content && latestPlanner.content.trim().length > 0) {
            // Turn completed! Agent output final markdown answer
            const contentText = latestPlanner.content.trim();
            const hasQuestion = endsWithQuestion(contentText);

            status = 'idle';
            if (hasQuestion) {
              statusLabel = 'Idle (Question)';
              state = 'attention';
              isQuestion = true;
              title = 'Antigravity asked a question!';
            } else {
              statusLabel = 'Idle (Ready)';
              state = 'waiting';
              isQuestion = false;
              title = 'Antigravity ready';
            }
            detail = contentText;
            fullContent = contentText;
          } else {
            // Still generating text
            status = 'running';
            statusLabel = 'Running (Generating...)';
            state = 'thinking';
            title = 'Antigravity generating response...';
            fullContent = 'Generating response...';
          }
        }
      } else {
        // Fallback if transcript empty
        status = 'idle';
        statusLabel = 'Idle (Ready)';
        state = 'waiting';
        title = 'Antigravity ready';
        detail = 'Waiting for input';
        fullContent = 'Antigravity session ready.';
      }

      // Turn cut off: last step done (tool result / system note / your prompt),
      // nothing since for AG_INTERRUPTED_MS → don't show "running" forever
      const quietMs = Date.now() - (Date.parse(latestEntry.created_at) || mtime || Date.now());
      if (status === 'running' && quietMs > AG_INTERRUPTED_MS && latestEntry.status !== 'RUNNING' &&
          ['GENERIC', 'SYSTEM_MESSAGE', 'CHECKPOINT', 'USER_INPUT'].includes(latestEntry.type)) {
        status = 'idle';
        statusLabel = 'Idle (Interrupted)';
        state = 'waiting';
        title = 'Antigravity stopped before finishing';
        detail = 'Stopped before finishing — send a message to continue';
        fullContent = INTERRUPTED_NOTE;
      }

      // Compute turnStartTs and turnSteps for current turn activity display
      let turnStartTs = latestUserInput ? (Date.parse(latestUserInput.created_at) || 0) : 0;
      let turnSteps = 0;
      if (status === 'running' && userStep >= 0) {
        for (const e of entries) {
          if ((e.step_index ?? -1) <= userStep) break;
          if (e.type === 'PLANNER_RESPONSE' && Array.isArray(e.tool_calls)) {
            turnSteps += e.tool_calls.length;
          }
        }
      }

      const sessionId = 'antigravity_' + convId;
      const recordId = `${plannerStep}_${userStep}_${status}_${statusLabel}_${latestEntry.step_index}`;
      const alertKey = sessionId + '_' + recordId;
      const isUnread = state === 'attention' && !this.dismissedAlerts.has(alertKey);
      const aiTitle = fMeta?.summary?.title || prevSession?.aiTitle || '';
      const promptTitle = this.formatTitle(cleanPrompt([...entries].reverse().find(e => e.type === 'USER_INPUT')?.content));

      let activity = null;
      if (status === 'running') {
        if (state === 'tool' && latestPlanner?.tool_calls?.[0]) {
          const tc = latestPlanner.tool_calls[0];
          activity = {
            kind: 'tool',
            tool: tc.name || 'tool',
            input: this.unwrapAgArgsObj(tc.args),
            turnStartTs,
            turnSteps,
          };
        } else {
          activity = { kind: 'thinking', turnStartTs, turnSteps };
        }
      }

      const sessionObj = {
        id: sessionId,
        sessionUuid: convId,
        appDataDir: fMeta?.appDataDir || prevSession?.appDataDir || 'antigravity',
        filePath,
        dbPath: fMeta?.dbPath || prevSession?.dbPath || null,
        source: 'antigravity',
        project: projectName,
        aiTitle,
        lastTurnTs: Date.parse(latestEntry.created_at) || mtime || 0,
        sessionTitle: aiTitle || promptTitle || prevSession?.sessionTitle || '',
        model,
        effort,
        context,
        cwd: projectCwd,
        status, // 'running' | 'idle'
        statusLabel, // e.g. "Running: run_command" or "Idle"
        state,
        title,
        detail: this.formatDetail(detail),
        fullContent: fullContent || detail,
        // While it works, nothing in the chat — the activity line shows progress
        placeholder: status === 'running',
        activity,
        pendingQuestion,
        isQuestion,
        mtime,
        lastRecordId: recordId,
        unread: isUnread,
        timestamp: new Date(mtime).toISOString()
      };

      if (isUnread && (!prevSession || prevSession.lastRecordId !== recordId || prevSession.state !== 'attention')) {
        this.emit('alert', sessionObj);
      }

      return sessionObj;
    } catch (err) {
      return null;
    }
  }

  // A turn that was cancelled, crashed, or had its window closed never writes an
  // end marker, so it would show "Running" forever. If the transcript hasn't
  // changed for STALE_RUNNING_MS, show it as idle. (Any new write re-parses it.)
  // After a reply is sent from the HUD, the transcript may not show the new
  // message for a second or two. Until it shows activity newer than the send,
  // keep the session "running" (max 3 min) instead of trusting a stale "idle".
  holdRunningAfterSend(updated, prev) {
    const since = prev?.runningSince;
    if (!since) return updated;
    const seenNewActivity = (updated.lastTurnTs || 0) >= since - 2000;
    if (updated.status === 'running' || seenNewActivity) {
      return updated; // transcript caught up → trust it
    }
    if (Date.now() - since > this.holdLimitMs(prev)) {
      // Gave up waiting and nothing ever showed up for this send
      if (prev.source === 'antigravity') {
        return {
          ...updated,
          statusLabel: 'Idle (Message not received)',
          detail: 'Antigravity never showed your message — check its window and send again',
          deliveryFailed: true,
        };
      }
      return updated;
    }
    return {
      ...updated,
      status: 'running',
      state: 'thinking',
      statusLabel: prev.statusLabel || 'Running (Thinking...)',
      title: prev.title || updated.title,
      unread: false,
      isQuestion: false,
      runningSince: since,
    };
  }

  expireStaleRunning() {
    const STALE_RUNNING_MS = 10 * 60 * 1000;
    const now = Date.now();
    let changed = false;
    for (const s of this.sessions.values()) {
      const lastActivity = Math.max(s.mtime || 0, s.runningSince || 0);
      if (s.status === 'running' && !s.stale && now - lastActivity > STALE_RUNNING_MS) {
        s.status = 'idle';
        s.state = 'waiting';
        s.statusLabel = 'Idle (No activity)';
        s.stale = true;
        changed = true;
      }
    }
    return changed;
  }

  // Read the last JSONL entries of a file (newest first). Starts with `initialBytes`
  // and doubles (up to 16MB) until `isEnough(entries)` is satisfied, so a single
  // huge line (big file read, base64 image) can't hide the latest state.
  readTailEntries(filePath, { initialBytes = 262144, maxEntries = 80, isEnough = (es) => es.length > 0 } = {}) {
    const MAX_BYTES = 16 * 1024 * 1024;
    const size = fs.statSync(filePath).size;
    let readSize = Math.min(size, initialBytes);
    let entries = [];
    const fd = fs.openSync(filePath, 'r');
    try {
      while (true) {
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, size - readSize);
        const lines = buffer.toString('utf-8').split('\n');
        if (readSize < size) lines.shift(); // first line is probably cut off
        entries = [];
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i].trim()) continue;
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed && typeof parsed === 'object') {
              entries.push(parsed);
              if (entries.length >= maxEntries) break;
            }
          } catch (e) {}
        }
        if (isEnough(entries) || readSize >= size || readSize >= MAX_BYTES) break;
        readSize = Math.min(size, readSize * 2, MAX_BYTES);
      }
    } finally {
      fs.closeSync(fd);
    }
    return entries;
  }

  // "[Request interrupted by user]" (Esc) ends the turn without an end_turn message
  isInterruptEntry(e) {
    const c = e.message?.content;
    const texts = typeof c === 'string' ? [c]
      : Array.isArray(c) ? c.map(b => (typeof b?.text === 'string' ? b.text : (typeof b?.content === 'string' ? b.content : ''))) : [];
    return texts.some(t => t.startsWith('[Request interrupted by user'));
  }

  // Single-line title from a prompt; full text kept (UI truncates + shows tooltip)
  formatTitle(text) {
    if (!text || typeof text !== 'string') return '';
    const cleaned = text
      .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ') // drop injected <tag>…</tag> blocks
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > 300 ? cleaned.slice(0, 297) + '...' : cleaned;
  }

  formatDetail(detail) {
    if (!detail) return '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
    const cleaned = detail
      .replace(/<[^>]+>/g, ' ') // Strip HTML/XML tags
      .replace(/```[\s\S]*?```/g, '[Code]')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/#{1,6}\s+/g, '') // Strip markdown headings
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Strip bold
      .replace(/\*([^*]+)\*/g, '$1') // Strip italics
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Strip link syntax
      .replace(/^\s*[-*•]\s+/gm, '') // Strip bullets
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned.length > 140 ? cleaned.slice(0, 137) + '...' : cleaned;
  }

  emitSync() {
    const list = Array.from(this.sessions.values());
    list.sort((a, b) => {
      if (a.unread && !b.unread) return -1;
      if (!a.unread && b.unread) return 1;
      // Prioritize running or attention
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      if (a.state === 'attention' && b.state !== 'attention') return -1;
      if (a.state !== 'attention' && b.state === 'attention') return 1;
      return b.mtime - a.mtime;
    });

    this.emit('sync', list);
  }

  getAllSessions() {
    return Array.from(this.sessions.values()).sort((a, b) => {
      if (a.unread && !b.unread) return -1;
      if (!a.unread && b.unread) return 1;
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return b.mtime - a.mtime;
    });
  }
}

module.exports = MultiAISessionWatcher;
