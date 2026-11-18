// Multi-Session Overlay Logic & Chat Stream with Image Attachment Support
if (window.marked) {
  window.marked.setOptions({
    gfm: true,
    breaks: true
  });
}

const overlayCard = document.getElementById('overlayCard');
const primaryBadge = document.getElementById('primaryBadge');
const badgeIcon = document.getElementById('badgeIcon');
const primaryDot = document.getElementById('primaryDot');
const mainTitle = document.getElementById('mainTitle');
const mainSub = document.getElementById('mainSub');
const badgeCount = document.getElementById('badgeCount');
const quickChips = document.getElementById('quickChips');

const popupBody = document.getElementById('popupBody');
const listView = document.getElementById('listView');
const detailView = document.getElementById('detailView');
const sessionsContainer = document.getElementById('sessionsContainer');
const countAll = document.getElementById('countAll');
const countRunning = document.getElementById('countRunning');
const countIdle = document.getElementById('countIdle');
const countAttention = document.getElementById('countAttention');

const btnSound = document.getElementById('btnSound');
const btnPin = document.getElementById('btnPin');
const btnClose = document.getElementById('btnClose');
const btnTest = document.getElementById('btnTest');
const tabButtons = document.querySelectorAll('.tab-btn');
const resizeGrip = document.getElementById('resizeGrip');

// Detail view & chat stream elements
const btnBack = document.getElementById('btnBack');
const detailLogo = document.getElementById('detailLogo');
const detailProject = document.getElementById('detailProject');
const detailModel = document.getElementById('detailModel');
const headerModel = document.getElementById('headerModel');
const detailStatusPill = document.getElementById('detailStatusPill');
const chatStream = document.getElementById('chatStream');
const replyTextarea = document.getElementById('replyTextarea');
const btnSendReply = document.getElementById('btnSendReply');
const btnCopyOnly = document.getElementById('btnCopyOnly');
const replyStatusMsg = document.getElementById('replyStatusMsg');

// Image attachment elements
const fileInput = document.getElementById('fileInput');
const btnAttachImg = document.getElementById('btnAttachImg');
const imagePreviewBar = document.getElementById('imagePreviewBar'); // attachments tray

let sessionsList = [];
let isExpanded = true; // the HUD is always expanded (no collapsed bar any more)
let soundEnabled = true;
let isPinned = true;
let currentFilter = 'all';
let commonModelText = ''; // model/effort most sessions use (session list)
let currentActiveSession = null;
// Display names for the agents ("Claude said", header, list). Each session can
// have its own name — click the name in the conversation header to rename that
// chat only (features-names.js saves them). Default = "Claude" / "Antigravity".
var agentNames = { claude: 'Claude', antigravity: 'Antigravity' };
var sessionAgentNames = {}; // session id -> your name for the agent in that chat
var syncedRecord = new Map(); // session id -> lastRecordId already drawn into its open chat
function agentLabel(source, sessionId) {
  const id = sessionId === undefined ? currentActiveSession?.id : sessionId;
  if (id && sessionAgentNames[id]) return sessionAgentNames[id];
  return source === 'claude' ? agentNames.claude : agentNames.antigravity;
}

// Attachments for the next message: [{ id, name, size, isImage, dataUrl?, path? }]
let attachments = [];
const sessionChatHistory = new Map(); // sessionId -> Array<{ role, text, image, time, source, isStreaming }>

// Title-bar summary (orb + "N AI Sessions…") is redundant while the session
// list is open, so it's hidden then; it stays when collapsed or in a conversation.
let usageOpen = false;

function syncHeaderMode() {
  const listOpen = isExpanded && !currentActiveSession && !usageOpen;
  document.body.classList.toggle('list-open', listOpen);
  document.body.classList.toggle('usage-open', isExpanded && usageOpen);
  document.body.classList.toggle('expanded', isExpanded);

  // Filter tabs always stay inside the window, at the top of the session list.
  const tabsBar = document.querySelector('.tabs-bar');
  const slot = document.getElementById('headerTabsSlot');
  if (tabsBar && slot && tabsBar.parentNode === slot) {
    listView.insertBefore(tabsBar, listView.firstElementChild);
  }
  renderApprovalToasts(); // hide the toast for a conversation you are looking at
}

// Clicking the MSN "mail" strip = show only the sessions that need you (click again for all)
document.getElementById('msnMail')?.addEventListener('click', () => {
  const on = document.querySelector('.tab-btn.active')?.dataset.filter === 'attention';
  document.querySelector(`.tab-btn[data-filter="${on ? 'all' : 'attention'}"]`)?.click();
});

// Window expansion
// Always expanded: the argument is ignored, kept so older callers still work.
function setExpanded() {
  isExpanded = true;
  syncHeaderMode();
  popupBody.style.display = 'flex';
  window.electronAPI.resizeWindow(true);
}

// Switch between List and Detail view
function showListView() {
  const fromChat = detailView.classList.contains('active');
  usageOpen = false;
  document.getElementById('usageView')?.classList.remove('active');
  detailView.classList.remove('active');
  listView.classList.add('active');
  currentActiveSession = null;
  syncHeaderMode();
  updateHeader();
  renderQuickChips();
  updateMiniAvatar();
  // (Vault code loads after this file: skip it if this runs during startup)
  if (typeof closeVaultFocus === 'function') {
    if (closeVaultFocus()) vaultZoomFrom = null;
    else if (fromChat) zoomOutToRobot(); else vaultZoomFrom = null;
  }
}

// Bubble header = name + time as separate spans, so each theme can format it
// (dark: "Claude • Just now", Aero: "Claude says:" with the time on the right)
function setBubbleMeta(meta, name, time) {
  meta.innerHTML = '';
  const nameEl = document.createElement('span');
  nameEl.className = 'meta-name';
  nameEl.textContent = name;
  const timeEl = document.createElement('span');
  timeEl.className = 'meta-time';
  timeEl.textContent = time;
  meta.appendChild(nameEl);
  meta.appendChild(timeEl);
}

// Append a message bubble to the chat stream
function appendBubble(msgArg) {
  const { role, text, image, images, files, time, source, id } = msgArg;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role} ${source || ''}`;
  if (id) bubble.id = id;

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';
  const senderName = role === 'user' ? 'You' : agentLabel(source);
  setBubbleMeta(meta, senderName, time || 'Just now');
  bubble.appendChild(meta);

  // Attached images (any number) and files
  const imgs = (images && images.length ? images : (image ? [image] : []));
  if (imgs.length) {
    const wrap = document.createElement('div');
    wrap.className = `chat-bubble-images${imgs.length > 1 ? ' multi' : ''}`;
    for (const src of imgs) {
      const imgElem = document.createElement('img');
      imgElem.className = 'chat-bubble-image';
      imgElem.src = src;
      imgElem.alt = 'Attached Image';
      imgElem.title = 'Click to view full image';
      imgElem.addEventListener('click', () => {
        const w = window.open('');
        w.document.write(`<body style="margin:0;background:#0d101a;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${src}" style="max-width:98%;max-height:98%;object-fit:contain;border-radius:8px;"/></body>`);
      });
      wrap.appendChild(imgElem);
    }
    bubble.appendChild(wrap);
  }
  if (files && files.length) {
    const list = document.createElement('div');
    list.className = 'chat-bubble-files';
    for (const f of files) {
      const chip = document.createElement('span');
      chip.className = 'bubble-file';
      chip.textContent = `📄 ${f}`;
      list.appendChild(chip);
    }
    bubble.appendChild(list);
  }

  // Render markdown or text
  const contentBox = document.createElement('div');
  contentBox.className = 'bubble-content';
  if (text) {
    if (window.marked && role === 'assistant') {
      contentBox.innerHTML = window.marked.parse(text);
    } else {
      renderUserText(contentBox, String(text));
    }
  }
  bubble.appendChild(contentBox);

  // Code click-to-copy
  attachCodeCopyHandlers(bubble);

  chatStream.appendChild(bubble);
  if (window.decorateBubble) window.decorateBubble(bubble, msgArg); // copy button, edited files (features.js)
  chatStream.scrollTop = chatStream.scrollHeight;
  return bubble;
}

function handleHudLinkClick(e, a) {
  const href = a.getAttribute('href') || '';
  if (!href || href.startsWith('#')) return;
  e.preventDefault();
  e.stopPropagation();
  if (/^conversation:\/\//i.test(href)) {
    const convId = href.replace(/^conversation:\/\/\/?/i, '').trim();
    const target = sessionsList.find((s) => s.sessionUuid === convId || s.id.endsWith(convId));
    if (target) showDetailView(target);
    return;
  }
  window.electronAPI.openFile?.(href).then((res) => {
    if (res === 'blocked' && replyStatusMsg) {
      replyStatusMsg.textContent = '⚠ Not opened: that file type can run programs. Open it from Explorer if you trust it.';
      setTimeout(() => { if (/^⚠ Not opened/.test(replyStatusMsg.textContent)) replyStatusMsg.textContent = ''; }, 6000);
    }
    if (res === 'missing' && replyStatusMsg) {
      replyStatusMsg.textContent = '⚠ File not found on disk';
      setTimeout(() => {
        if (replyStatusMsg.textContent === '⚠ File not found on disk') replyStatusMsg.textContent = '';
      }, 3000);
    }
  });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (a) handleHudLinkClick(e, a);
}, true);

// Typewriter: new reply text types itself out (with a blinking caret) instead of
// appearing a block at a time. Re-renders the Markdown of the visible part each
// frame; any backlog finishes in about 0.7 s, so it never falls far behind.
// `before` = the text that was on screen until now ('' = a brand-new bubble), so
// only the NEW part types out.
function closeOpenMarks(t) {
  if (((t.match(/^```/gm) || []).length % 2) === 1) return t + '\n```'; // inside a code block
  const noCode = t.replace(/`[^`]*`/g, '');
  if ((noCode.match(/`/g) || []).length % 2) t += '`';
  if (((t.replace(/`[^`]*`/g, '').match(/\*\*/g) || []).length % 2) === 1) t += '**';
  return t;
}
function typeInto(box, text, bubble, before) {
  if (!box) return;
  const render = (t, done) => {
    box.innerHTML = window.marked ? window.marked.parse(t) : t;
    if (!done) {
      // caret at the very end of the text: the last paragraph / list item / heading
      // (not inside a bold or code word that happens to come last)
      let n = box.lastElementChild;
      while (n && n.lastElementChild && /^(UL|OL|LI|BLOCKQUOTE|DIV)$/.test(n.tagName)) n = n.lastElementChild;
      if (n && /^(STRONG|EM|CODE|A|B|I|SPAN)$/.test(n.tagName)) n = n.parentElement;
      (n || box).insertAdjacentHTML('beforeend', '<span class="tw-caret"></span>');
    } else if (bubble) attachCodeCopyHandlers(bubble);
  };
  text = String(text || '');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || text.length > 30000) {
    if (box._tw?.raf) clearTimeout(box._tw.raf);
    box._tw = { shown: text.length, text };
    render(text, true);
    return;
  }
  const prev = String(before ?? text);
  const st = box._tw || (box._tw = { shown: prev.length, text: prev, raf: 0 });
  // keep what is already typed if the new text continues it; otherwise restart where they differ
  let same = 0;
  const lim = Math.min(st.shown, st.text.length, text.length);
  while (same < lim && st.text.charCodeAt(same) === text.charCodeAt(same)) same++;
  st.shown = same;
  st.text = text;
  if (st.raf) return; // already typing; it picks up the new target
  const step = () => {
    const left = st.text.length - st.shown;
    if (left <= 0) { st.raf = 0; render(st.text, true); return; }
    st.shown += Math.max(2, Math.ceil(left / 42));
    render(closeOpenMarks(st.text.slice(0, st.shown)), false);
    st.raf = setTimeout(step, 16);
  };
  // a timer, not requestAnimationFrame: keeps typing while the HUD is hidden/minimized
  st.raf = setTimeout(step, 16);
}

// Your own messages: keep line breaks, and draw ```fenced``` blocks as code boxes
// (e.g. lines referenced from the Changes panel). Everything stays plain text —
// nothing you typed is turned into HTML.
function renderUserText(box, text) {
  box.classList.add('user-text');
  // "Explain …" requests from the Changes panel → pills (logic/chat/prompt-pills.js)
  const segs = window.splitExplainPrompts?.(text);
  if (segs) {
    for (const s of segs) {
      if (s.pill) box.appendChild(window.makeExplainPill(s.pill));
      else if (s.text.trim()) { const span = document.createElement('div'); renderUserTextPlain(span, s.text.trim()); box.appendChild(span); }
    }
    return;
  }
  renderUserTextPlain(box, text);
}
function renderUserTextPlain(box, text) {
  const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)\n?^\1?\2[ \t]*$/gm;
  let last = 0, m;
  const addText = (t) => { if (t) box.appendChild(document.createTextNode(t)); };
  while ((m = fence.exec(text))) {
    addText(text.slice(last, m.index).replace(/\n$/, ''));
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (m[3]) code.className = `language-${m[3].toLowerCase()}`;
    code.textContent = m[4];
    pre.appendChild(code);
    box.appendChild(pre);
    last = fence.lastIndex;
    if (text[last] === '\n') last++;
  }
  // an unclosed ``` (still typing, or cut off) → show the rest as code too
  const rest = text.slice(last);
  const open = rest.match(/^([\s\S]*?)(?:^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*)$/);
  if (open) {
    addText(open[1]);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (open[3]) code.className = `language-${open[3].toLowerCase()}`;
    code.textContent = open[4];
    pre.appendChild(code);
    box.appendChild(pre);
  } else addText(rest);
}

function attachCodeCopyHandlers(container) {
  window.renderDiagrams?.(container); // ```mermaid blocks → diagrams (logic/chat/diagrams.js)
  window.highlightCode?.(container);  // syntax colours (logic/chat/highlight.js)
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.dataset.copyBound) return;
    pre.dataset.copyBound = '1';
    pre.style.cursor = 'text';
    pre.title = 'Select text or click to copy block';
    pre.addEventListener('click', (e) => {
      e.stopPropagation();
      const selected = window.getSelection ? window.getSelection().toString() : '';
      if (selected && selected.length > 0) return;
      const code = pre.querySelector('code')?.innerText || pre.innerText;
      window.electronAPI.copyToClipboard(code);
      const originalBorder = pre.style.borderColor;
      pre.style.borderColor = '#10b981';
      setTimeout(() => pre.style.borderColor = originalBorder, 1000);
    });
  });
  container.querySelectorAll('a[href]').forEach((a) => {
    if (a.dataset.linkBound) return;
    a.dataset.linkBound = '1';
    a.addEventListener('click', (e) => handleHudLinkClick(e, a));
  });
}

function showDetailView(session) {
  if (typeof vaultFocus !== 'undefined' && vaultFocus && !vaultFocusOpening) closeVaultFocus(false);
  currentActiveSession = session;
  usageOpen = false;
  document.getElementById('usageView')?.classList.remove('active');
  syncHeaderMode();
  listView.classList.remove('active');
  detailView.classList.add('active');

  // Synchronize header and quick chips with active session
  updateHeader();
  renderQuickChips();

  // Header identity
  detailLogo.className = `card-logo ${session.source}`;
  detailLogo.textContent = session.source === 'claude' ? 'C' : 'A';
  detailProject.textContent = session.project;
  detailProject.title = session.sessionTitle || session.project;
  renderModelChip(detailModel, session);

  // Status pill in detail view
  if (session.unread || session.state === 'attention') {
    detailStatusPill.className = 'status-pill attention';
    detailStatusPill.innerHTML = '<span class="dot-attention"></span> Needs Input';
  } else if (session.status === 'running') {
    detailStatusPill.className = 'status-pill running';
    detailStatusPill.innerHTML = `<span class="dot-running"></span> ${session.statusLabel || 'Running'}`;
  } else {
    detailStatusPill.className = 'status-pill idle';
    detailStatusPill.innerHTML = `<span class="dot-idle"></span> ${session.statusLabel || 'Idle'}`;
  }

  // Render chat history for this session
  chatStream.innerHTML = '';
  const markdownRaw = session.fullContent || session.detail || '*(No content recorded)*';

  let history = sessionChatHistory.get(session.id);
  if (session.draft) {
    history = history || [];
    sessionChatHistory.set(session.id, history);
  } else if (!history || history.length === 0) {
    history = [{
      role: 'assistant',
      text: markdownRaw,
      time: formatTimeAgo(session.mtime),
      source: session.source
    }];
    sessionChatHistory.set(session.id, history);
  } else if (history[0].role === 'assistant' && history.length === 1) {
    history[0].text = markdownRaw;
    history[0].time = formatTimeAgo(session.mtime);
  }

  history.forEach((msg) => { msg.el = appendBubble(msg); }); // keep a handle for live updates
  syncedRecord.set(session.id, session.lastRecordId);
  if (!session.draft && !history.fromDisk) loadHistoryFromDisk(session, history);
  if (session.draft && !history.length) {
    addSystemNote(`New conversation in ${session.cwd || session.project}. Type your first message to start it.`);
  }
  onDetailOpened(session);

  clearAttachedImage();
  replyTextarea.value = '';
  replyStatusMsg.textContent = '';
  setExpanded(true);
  setTimeout(() => replyTextarea.focus(), 150);
}

// Older messages come from the session's transcript on disk (the HUD itself
// only remembers chat while it is running). Replaces the one-message
// placeholder history with the real conversation, once per session.
async function loadHistoryFromDisk(session, history, preloaded) {
  if ((session.source !== 'claude' && session.source !== 'antigravity') || !window.electronAPI.getSessionHistory) return;
  // Only when we have nothing better than the "latest reply" placeholder
  // (`preloaded` = the disk messages were already fetched because something sent from
  // elsewhere is missing from the chat; then the whole chat is redrawn from disk)
  if (!preloaded && (history.length > 1 || (history[0] && history[0].role !== 'assistant'))) return;
  let msgs = preloaded || null;
  if (!msgs) { try { msgs = await window.electronAPI.getSessionHistory(session.id); } catch (e) { return; } }
  if (!msgs || !msgs.length) return;
  // Still looking at the same conversation, and nothing was sent/streamed meanwhile?
  if (currentActiveSession?.id !== session.id) return;
  const cur = sessionChatHistory.get(session.id);
  if (cur !== history || (!preloaded && history.length > 1) || document.getElementById('streamingBubble')) return;

  const loaded = msgs.map((m) => ({
    role: m.role,
    text: m.role === 'user' && !m.text && m.imageCount ? `(${m.imageCount} image${m.imageCount > 1 ? 's' : ''})` : m.text,
    time: m.ts ? formatTimeAgo(m.ts) : '',
    source: m.role === 'assistant' ? session.source : undefined,
    edits: m.edits,
  }));
  loaded.fromDisk = true;
  sessionChatHistory.set(session.id, loaded);

  chatStream.innerHTML = '';
  loaded.forEach((msg) => { msg.el = appendBubble(msg); });
  // Approval cards for this session live in the chat too
  for (const req of pendingApprovals.values()) {
    if (req.sessionId === session.id) renderApprovalCard(req);
  }
  chatStream.scrollTop = chatStream.scrollHeight;
}

if (btnBack) btnBack.addEventListener('click', () => {
  showListView();
});

// Image attachment handling
btnAttachImg.addEventListener('click', () => {
  fileInput.click();
});

// Quick snip: drag over any part of the screen → attached as a PNG
const btnSnip = document.getElementById('btnSnip');
if (btnSnip) btnSnip.addEventListener('click', async () => {
  if (attachments.length >= MAX_ATTACHMENTS) {
    replyStatusMsg.textContent = `⚠ Up to ${MAX_ATTACHMENTS} attachments per message`;
    return;
  }
  btnSnip.disabled = true;
  try {
    const dataUrl = await window.electronAPI.quickSnip?.();
    if (dataUrl && dataUrl.startsWith('data:image/')) {
      const d = new Date();
      const stamp = `${d.getHours()}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
      attachments.push({
        id: Math.random().toString(36).slice(2),
        name: `snip-${stamp}.png`,
        size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
        isImage: true,
        path: '',
        dataUrl,
      });
      renderAttachments();
    }
  } catch (e) {
    replyStatusMsg.textContent = '⚠ Snip failed';
  } finally {
    btnSnip.disabled = false;
    replyTextarea.focus();
  }
});

fileInput.addEventListener('change', (e) => {
  attachFiles(e.target.files);
  fileInput.value = ''; // so picking the same file again still fires
});

const MAX_ATTACHMENTS = 20;
const MAX_INLINE_BYTES = 20 * 1024 * 1024; // pasted files without a disk path

function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Add any number of images / files. Images are sent to the agent as images;
// other files are passed as paths it can open (pasted ones are saved to temp).
async function attachFiles(fileList) {
  const files = [...(fileList || [])].filter(Boolean);
  for (const file of files) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      replyStatusMsg.textContent = `⚠ Up to ${MAX_ATTACHMENTS} attachments per message`;
      break;
    }
    const isImage = (file.type || '').startsWith('image/');
    const filePath = window.electronAPI.getPathForFile?.(file) || '';
    const a = {
      id: Math.random().toString(36).slice(2),
      name: file.name || (isImage ? 'pasted-image.png' : 'pasted-file'),
      size: file.size || 0,
      isImage,
      path: filePath,
    };
    // skip exact duplicates (same file picked twice)
    if (filePath && attachments.some((x) => x.path === filePath)) continue;
    try {
      if (isImage) a.dataUrl = await readAsDataUrl(file);
      else if (!filePath) {
        if (file.size > MAX_INLINE_BYTES) { replyStatusMsg.textContent = `⚠ ${a.name} is too large to paste`; continue; }
        a.dataUrl = await readAsDataUrl(file);
      }
    } catch (e) { continue; }
    attachments.push(a);
  }
  renderAttachments();
}

// Kept for older callers
function attachImageFile(file) { attachFiles([file]); }

function renderAttachments() {
  imagePreviewBar.innerHTML = '';
  for (const a of attachments) {
    const chip = document.createElement('div');
    chip.className = `attach-chip ${a.isImage ? 'is-image' : 'is-file'}`;
    chip.title = `${a.path || a.name}${a.size ? ' · ' + fmtBytes(a.size) : ''}`;
    if (a.isImage) {
      const img = document.createElement('img');
      img.className = 'attach-thumb';
      img.src = a.dataUrl;
      img.alt = a.name;
      chip.appendChild(img);
    } else {
      const ico = document.createElement('span');
      ico.className = 'attach-ico';
      ico.textContent = (a.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
      chip.appendChild(ico);
    }
    const name = document.createElement('span');
    name.className = 'attach-name';
    name.textContent = a.name;
    const x = document.createElement('button');
    x.className = 'attach-remove';
    x.title = 'Remove';
    x.textContent = '✕';
    x.addEventListener('click', () => {
      attachments = attachments.filter((y) => y.id !== a.id);
      renderAttachments();
    });
    chip.append(name, x);
    imagePreviewBar.appendChild(chip);
  }
  if (attachments.length > 1) {
    const clear = document.createElement('button');
    clear.className = 'attach-clear';
    clear.textContent = `Remove all (${attachments.length})`;
    clear.addEventListener('click', clearAttachedImage);
    imagePreviewBar.appendChild(clear);
  }
  imagePreviewBar.style.display = attachments.length ? 'flex' : 'none';
}

function clearAttachedImage() {
  attachments = [];
  fileInput.value = '';
  renderAttachments();
}

// Payload pieces for send-reply
function attachmentPayload() {
  const images = attachments.filter((a) => a.isImage).map((a) => a.dataUrl);
  const files = attachments.filter((a) => !a.isImage).map((a) => ({ name: a.name, path: a.path, data: a.path ? undefined : a.dataUrl }));
  return { images, image: images[0] || null, files };
}

// Paste images / files into the textarea (Ctrl+V) — all of them, not just one
replyTextarea.addEventListener('paste', (e) => {
  const items = [...((e.clipboardData || e.originalEvent.clipboardData).items || [])];
  const files = items.filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
  if (files.length) {
    e.preventDefault();
    attachFiles(files);
  }
});

// Drag and drop any number of files into the conversation
detailView.addEventListener('dragover', (e) => e.preventDefault());
detailView.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) attachFiles(e.dataTransfer.files);
});

// Reply Submission (Displays user bubble immediately & sends directly to Claude / Antigravity)
// Stick to the bottom: while you're at the bottom of the chat, anything that
// appears (reply text, the "Edited N files" card, images loading, the activity
// card resizing the chat) keeps you there. Scroll up to read and it stays put.
let chatPinned = true;
chatStream.addEventListener('scroll', () => {
  chatPinned = chatStream.scrollHeight - chatStream.scrollTop - chatStream.clientHeight < 80;
}, { passive: true });
const keepPinned = () => { if (chatPinned) chatStream.scrollTop = chatStream.scrollHeight; };
new MutationObserver(keepPinned).observe(chatStream, { childList: true, subtree: true, characterData: true });
new ResizeObserver(keepPinned).observe(chatStream);
chatStream.addEventListener('load', keepPinned, true); // images inside bubbles

// After you send: jump to the bottom and stay there while the layout settles
// (the activity card appears under the chat and makes it shorter; attached
// images finish loading and make the bubble taller).
function stickChatToBottom(bubble) {
  const toBottom = () => { chatStream.scrollTop = chatStream.scrollHeight; };
  toBottom();
  requestAnimationFrame(toBottom);
  const until = Date.now() + 1500;
  const ro = new ResizeObserver(() => { if (Date.now() < until) toBottom(); });
  ro.observe(chatStream);
  setTimeout(() => ro.disconnect(), 1500);
  bubble?.querySelectorAll?.('img').forEach((img) => img.addEventListener('load', () => { if (Date.now() < until + 3000) toBottom(); }, { once: true }));
}

function submitReply(text) {
  const reply = (text || replyTextarea.value || '').trim();
  const att = attachmentPayload();
  const hasAttachments = attachments.length > 0;
  const fileNames = attachments.filter((a) => !a.isImage).map((a) => a.name);

  if (!reply && !hasAttachments) return;

  // HUD-handled slash commands (/model, /effort, /clear, /mcp, /help) never reach Claude
  if (!hasAttachments && reply.startsWith('/') && runHudCommand(reply)) {
    replyTextarea.value = '';
    hideSlashMenu();
    return;
  }
  hideSlashMenu();

  // New chat: the first message starts the session; wait until Claude has
  // named it before sending another (it would have nothing to resume yet).
  if (currentActiveSession?.draft && currentActiveSession.draftSent) {
    replyStatusMsg.textContent = '⏳ Starting the new conversation… send again in a moment';
    return;
  }

  // Sent while the agent is still busy: the agent queues it and answers after the
  // current reply, but our "You said" box is drawn right now, ABOVE the reply that
  // is still being written. Redraw from the transcript until that turn is over.
  if (currentActiveSession && currentActiveSession.status === 'running') resyncFromDisk.add(currentActiveSession.id);

  const userMsg = {
    role: 'user',
    text: reply,
    images: att.images,
    files: fileNames,
    time: 'Just now'
  };

  // 1. Immediately append user message bubble to dialog & history!
  const userBubble = appendBubble(userMsg);
  stickChatToBottom(userBubble);

  if (currentActiveSession) {
    let history = sessionChatHistory.get(currentActiveSession.id);
    if (!history) {
      history = [];
      sessionChatHistory.set(currentActiveSession.id, history);
    }
    history.push(userMsg);

    // Create live streaming assistant bubble
    const oldStream = document.getElementById('streamingBubble');
    if (oldStream) oldStream.remove();

    // Hidden until real reply text streams in; the activity line shows progress
    const pendingBubble = appendBubble({
      id: 'streamingBubble',
      role: 'assistant',
      text: '',
      time: 'Thinking...',
      source: currentActiveSession.source
    });
    pendingBubble?.classList?.add('pending');
    liveActivity.set(currentActiveSession.id, { act: { kind: 'sending', since: Date.now() }, at: Date.now() });
    activityFirstSeen.set(currentActiveSession.id, Date.now());

    currentActiveSession.status = 'running';
    currentActiveSession.statusLabel = 'Running (Thinking...)';
    currentActiveSession.unread = false;
    updateConvoHeader(currentActiveSession);
    detailStatusPill.className = 'status-pill running';
    detailStatusPill.innerHTML = '<span class="dot-running"></span> Running (Thinking...)';
    window.electronAPI.dismissSession(currentActiveSession.id);
  }

  // 2. Send IPC to main process (runs Claude --resume or Antigravity chat)
  window.electronAPI.sendReply({
    text: reply,
    ...att, // image (first), images, files
    session: currentActiveSession,
    options: takeReplyOptions(currentActiveSession)
  });

  replyStatusMsg.textContent = currentActiveSession?.source === 'claude'
    ? '⚡ Sent to Claude Code! Streaming response...'
    : '⚡ Sent to Antigravity IDE!';

  replyTextarea.value = '';
  clearAttachedImage();

  renderAll();
}

btnSendReply.addEventListener('click', () => submitReply());

// Copy only button
if (btnCopyOnly) {
  btnCopyOnly.addEventListener('click', () => {
    const text = replyTextarea.value.trim();
    const att = attachmentPayload();
    if (!text && !att.image) return;

    window.electronAPI.sendReply({
      text,
      image: att.image, // the clipboard holds one image
      session: currentActiveSession,
      copyOnly: true
    });

    replyStatusMsg.textContent = '✓ Copied to clipboard!';
    setTimeout(() => replyStatusMsg.textContent = '', 2500);
  });
}

// Enter to send, Shift+Enter for newline
replyTextarea.addEventListener('keydown', (e) => {
  if (slashMenuHandleKey(e)) return; // arrows / Tab / Enter / Esc inside the "/" menu
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitReply();
  }
});


// Corner Drag-to-Resize Logic
if (resizeGrip) {
  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 480;
  let startHeight = 74;

  // Pointer capture keeps the moves coming when the cursor runs ahead of the window edge (a fast drag used
  // to lose the mouse and stall); the start size is read at once (no await, so the first moves aren't lost);
  // at most one resize per frame.
  let pending = null, frame = 0;
  const flush = () => { frame = 0; if (pending) window.electronAPI.setWindowSize(pending[0], pending[1]); pending = null; };
  resizeGrip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.screenX;
    startY = e.screenY;
    startWidth = window.outerWidth;
    startHeight = window.outerHeight;
    resizeGrip.setPointerCapture(e.pointerId);
    resizeGrip.classList.add('resizing');
    // the exact size from the main process, if it differs (e.g. display scaling)
    window.electronAPI.getWindowSize?.().then(([w, h]) => {
      if (!isResizing || !w || !h) return;
      startWidth = w; startHeight = h;
    }).catch(() => {});
  });
  resizeGrip.addEventListener('pointermove', (e) => {
    if (!isResizing) return;
    const newW = Math.max(360, Math.min(1400, startWidth + (e.screenX - startX)));
    const newH = Math.max(240, Math.min(1200, startHeight + (e.screenY - startY))); // never collapses
    pending = [Math.round(newW), Math.round(newH)];
    if (!frame) frame = requestAnimationFrame(flush);
  });
  const stopResize = (e) => {
    if (!isResizing) return;
    isResizing = false;
    resizeGrip.classList.remove('resizing');
    try { resizeGrip.releasePointerCapture(e.pointerId); } catch (_) {}
    if (frame) { cancelAnimationFrame(frame); flush(); }
  };
  resizeGrip.addEventListener('pointerup', stopResize);
  resizeGrip.addEventListener('pointercancel', stopResize);
  resizeGrip.addEventListener('lostpointercapture', stopResize);
}

// Drag the window by the title bar (anywhere except buttons / session chips).
// Pointer capture keeps pointerup coming even if released outside the window.
// The docked mini tab uses the same mechanism: main.js treats a press without
// movement as a click (→ undock) and handles the magnetic edge snapping.
(() => {
  if (!window.electronAPI.startWindowDrag) return;

  const makeDraggable = (el, ignoreSelector) => {
    if (!el) return;
    let dragging = false;
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      window.electronAPI.stopWindowDrag();
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // presses on a control inside `el` don't drag (only look inside el: its
      // ancestors, like .view-panel, must not count)
      const hit = ignoreSelector && e.target.closest(ignoreSelector);
      if (hit && hit !== el && el.contains(hit)) return;
      e.preventDefault();
      dragging = true;
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      window.electronAPI.startWindowDrag();
    });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('lostpointercapture', stop);
    window.addEventListener('blur', stop);
  };

  window.makeHudDraggable = makeDraggable; // the address bar uses it too (Shelter hides the title bar)
  makeDraggable(document.querySelector('.pill-header'), 'button, .quick-chip, .quick-chips, .controls, input, textarea, a');
  // the toolbars' empty space drags too (Shelter has no title bar or top strip)
  const TOOLBAR_SKIP = 'button, input, textarea, a, select, [class*="panel"], [class*="menu"]';
  makeDraggable(document.getElementById('listToolbar'), TOOLBAR_SKIP);
  makeDraggable(document.querySelector('#detailView .convo-toolbar'), TOOLBAR_SKIP);
  makeDraggable(document.getElementById('miniDock'), '.mini-btn');

  // Dock state from main: swap between the full HUD and the mini edge tab
  if (window.electronAPI.onDockState) {
    let phaseTimer = null;
    window.electronAPI.onDockState(({ docked, side, phase }) => {
      if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null; }
      document.body.classList.toggle('dock-left', side === 'left');
      document.body.classList.toggle('dock-right', side === 'right');
      document.body.classList.toggle('docking', phase === 'docking');
      document.body.classList.toggle('undocking', phase === 'undocking');
      document.body.classList.toggle('docked', !!docked);
      if (phase === 'undocking') {
        phaseTimer = setTimeout(() => {
          document.body.classList.remove('undocking', 'dock-left', 'dock-right');
          phaseTimer = null;
        }, 280);
      }
      if (!docked && phase !== 'docking') {
        // Re-sync height in case an alert expanded/collapsed us while docked
        setTimeout(() => window.electronAPI.resizeWindow(isExpanded), 330);
      }
    });
  }
})();

// Theme switch: Aero (default) → Vista Dark → Dark → … (choice remembered).
// Vista Dark re-skins the Aero layout, so it keeps .theme-aero as well.
(() => {
  const btnTheme = document.getElementById('btnTheme');
  const THEMES = ['aero', 'xp', 'vista', 'dark'];
  const LABELS = { aero: 'Windows 7', xp: 'Windows XP', vista: 'Vista Dark', dark: 'Dark' };
  // Style: "shelter" (default) = the underground-base look in theme-shelter.css, built on
  // the plain dark layout; "classic" = the Windows themes below.
  // "work" = a plain, flat office look (theme-work.css): no Vault, robots or avatars.
  // "pip" = Work's layout (sidebar + chat, no Vault) in the Pip-Boy look: it carries both the Work and the Shelter
  // classes, plus style-pip for the few rules that are its own (theme-pip.css).
  let uiStyle = ['classic', 'work', 'pip'].includes(window.electronAPI.settings?.uiStyle) ? window.electronAPI.settings.uiStyle : 'shelter';
  // Shelter's chat layout: both pictures live in the contact strip (agent left, you
  // right) instead of a column beside the chat. Classic keeps the column.
  const placeChatPictures = (shelter) => {
    const side = document.querySelector('.convo-side');
    const contact = document.querySelector('.convo-contact');
    const agent = document.getElementById('dpAgent');
    const you = document.getElementById('dpUser');
    if (!side || !contact || !agent || !you) return;
    if (shelter) { contact.prepend(agent); contact.append(you); } else side.append(agent, you);
  };
  const apply = (theme) => {
    const pip = uiStyle === 'pip';
    const shelter = uiStyle === 'shelter';
    const work = uiStyle === 'work';
    const classic = uiStyle === 'classic';
    placeChatPictures(shelter);
    document.body.classList.toggle('style-shelter', shelter || pip);
    document.body.classList.toggle('style-work', work || pip);
    document.body.classList.toggle('style-pip', pip);
    document.body.classList.toggle('theme-aero', classic && theme !== 'dark');
    document.body.classList.toggle('theme-vista', classic && theme === 'vista');
    document.body.classList.toggle('theme-xp', classic && theme === 'xp');
    const v = document.getElementById('setThemeVal');
    if (v) v.textContent = LABELS[theme] || 'Aero';
  };
  let theme = 'aero';
  theme = window.electronAPI.settings?.theme || 'aero';
  if (!THEMES.includes(theme)) theme = 'aero';
  apply(theme);
  if (btnTheme) {
    // Style row (Shelter / Classic) above the Windows theme choice
    const styleRow = document.createElement('div');
    styleRow.className = 'set-row set-style-row';
    styleRow.innerHTML = '<span class="set-ico">🏗</span><span class="set-label">Style</span>';
    const stylePills = document.createElement('div');
    stylePills.className = 'theme-pills style-pills';
    const STYLES = [['shelter', 'Shelter'], ['pip', 'Pip-Boy'], ['classic', 'Classic (Windows)'], ['work', 'Work']];
    const markStyle = () => styleBtns.forEach((x, i) => x.classList.toggle('active', STYLES[i][0] === uiStyle));
    const styleBtns = STYLES.map(([key, label]) => {
      const b = document.createElement('button');
      b.className = 'theme-pill';
      b.textContent = label;
      b.addEventListener('click', () => {
        if ((key === 'work' || key === 'pip') && document.body.classList.contains('vault-focus')) window.closeVaultFocus?.(false);
        uiStyle = key;
        window.electronAPI.storeSet('uiStyle', uiStyle);
        apply(theme);
        markStyle();
        // Work has no Vault: the contact list switches to plain rows (and back)
        applyListView();
        renderSessionCards(true);
      });
      stylePills.appendChild(b);
      return b;
    });
    markStyle();
    btnTheme.before(styleRow, stylePills);
    // Segmented theme pills inside the Settings dialog
    const sub = document.createElement('div');
    sub.className = 'theme-sub theme-pills';
    const items = THEMES.map((t) => {
      const b = document.createElement('button');
      b.className = 'theme-pill';
      b.textContent = LABELS[t];
      b.addEventListener('click', () => {
        theme = t;
        apply(theme);
        window.electronAPI.storeSet('theme', theme);
        mark();
      });
      sub.appendChild(b);
      return b;
    });
    const mark = () => items.forEach((b, i) => b.classList.toggle('active', THEMES[i] === theme));
    mark();
    btnTheme.after(sub);
  }
})();

// Sound toggle
btnSound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  window.soundSynth.enabled = soundEnabled;
  btnSound.classList.toggle('active', soundEnabled);
  const ico = btnSound.querySelector('.set-ico');
  if (ico) ico.textContent = soundEnabled ? '🔔' : '🔕';
});

// Nudge toggle: shake + glow when a chat finishes (main/ipc/snap.js reads "nudge")
const btnNudge = document.getElementById('btnNudge');
if (btnNudge) {
  btnNudge.classList.toggle('active', window.electronAPI.settings?.nudge !== false);
  btnNudge.addEventListener('click', () => {
    const on = !btnNudge.classList.contains('active');
    btnNudge.classList.toggle('active', on);
    window.electronAPI.storeSet('nudge', on);
  });
}

// Sleeping robots: in the Vault, chats idle 2+ days nap in the storage drawer (room-build.js)
var vaultSleepOn = window.electronAPI.settings?.vaultSleep !== false;
const btnSleep = document.getElementById('btnSleep');
if (btnSleep) {
  btnSleep.classList.toggle('active', vaultSleepOn);
  btnSleep.addEventListener('click', () => {
    vaultSleepOn = !btnSleep.classList.contains('active');
    btnSleep.classList.toggle('active', vaultSleepOn);
    window.electronAPI.storeSet('vaultSleep', vaultSleepOn);
    renderSessionCards(true);
  });
}

// Room windows: a scene on each Vault room's back wall (window-art.js)
var vaultWindowsOn = window.electronAPI.settings?.vaultWindows !== false;
const btnWindows = document.getElementById('btnWindows');
if (btnWindows) {
  btnWindows.classList.toggle('active', vaultWindowsOn);
  btnWindows.addEventListener('click', () => {
    vaultWindowsOn = !btnWindows.classList.contains('active');
    btnWindows.classList.toggle('active', vaultWindowsOn);
    window.electronAPI.storeSet('vaultWindows', vaultWindowsOn);
    renderSessionCards(true);
  });
}

// Pin toggle
btnPin.addEventListener('click', async () => {
  isPinned = await window.electronAPI.togglePin();
  btnPin.classList.toggle('active', isPinned);
});

// Settings modal dialog (shared by the contact-list and conversation toolbars)
const tbSettings = document.getElementById('tbSettings');
const lbSettings = document.getElementById('lbSettings');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel = document.getElementById('settingsPanel');
const btnSettingsClose = document.getElementById('btnSettingsClose');
const btnSettingsDone = document.getElementById('btnSettingsDone');
let settingsLayoutBuilt = false;

function buildSettingsDialogLayout() {
  if (settingsLayoutBuilt || !settingsPanel) return;
  settingsLayoutBuilt = true;
  const byId = (id) => document.getElementById(id);
  const makeSection = (title, nodes) => {
    const valid = nodes.filter(Boolean);
    if (!valid.length) return null;
    const sec = document.createElement('div');
    sec.className = 'settings-sec';
    const h = document.createElement('div');
    h.className = 'settings-sec-title';
    h.textContent = title;
    const card = document.createElement('div');
    card.className = 'settings-card';
    for (const n of valid) card.appendChild(n);
    sec.append(h, card);
    return sec;
  };

  const themePills = settingsPanel.querySelector('.theme-pills:not(.style-pills)');
  const digestBox = settingsPanel.querySelector('.set-digest');
  const restartBtn = byId('btnRestartApp');
  const footerLeft = byId('settingsFooterLeft');
  if (restartBtn && footerLeft) {
    restartBtn.className = 'sk-btn';
    restartBtn.innerHTML = '🔄 Restart app';
    footerLeft.appendChild(restartBtn);
  }
  if (footerLeft) {
    const quit = document.createElement('button');
    quit.className = 'sk-btn sk-quit';
    quit.textContent = '⏻ Quit';
    quit.title = 'Close the HUD';
    quit.addEventListener('click', () => window.electronAPI.closeWindow());
    footerLeft.appendChild(quit);
  }

  const appearance = makeSection('Appearance', [
    settingsPanel.querySelector('.set-style-row'), settingsPanel.querySelector('.style-pills'), byId('btnTheme'), themePills,
  ]);
  const behavior = makeSection('Behavior', [byId('btnSound'), byId('btnNudge'), byId('btnSleep'), byId('btnWindows'), byId('btnPin'), byId('btnNotify'), byId('btnShowAg')]);
  const tools = makeSection('Tools & Data', [
    byId('btnDigest'), digestBox, byId('btnExport'), byId('btnCreateShortcut'), byId('btnRules'), byId('btnInstallSkill'),
  ]);

  // Keep any extra rows added later by other scripts
  const placed = new Set([appearance, behavior, tools]);
  const extras = [...settingsPanel.children].filter((el) => !placed.has(el) && !el.classList.contains('set-sep'));
  settingsPanel.innerHTML = '';
  for (const s of [appearance, behavior, tools]) if (s) settingsPanel.appendChild(s);
  if (extras.length) {
    const extraSec = makeSection('Other', extras);
    if (extraSec) settingsPanel.appendChild(extraSec);
  }
}

function openSettingsDialog(btn) {
  if (!settingsOverlay) return;
  if (settingsOverlay.style.display !== 'none') { closeSettingsPanel(); return; }
  buildSettingsDialogLayout();
  const mcp = document.getElementById('mcpPanel');
  if (mcp) mcp.style.display = 'none';
  if (typeof closeUsagePanel === 'function') closeUsagePanel();
  settingsOverlay.style.display = 'flex';
  btn?.classList.add('open');
}
function closeSettingsPanel() {
  if (settingsOverlay) settingsOverlay.style.display = 'none';
  tbSettings?.classList.remove('open');
  lbSettings?.classList.remove('open');
}
tbSettings?.addEventListener('click', (e) => { e.stopPropagation(); openSettingsDialog(tbSettings); });
lbSettings?.addEventListener('click', (e) => { e.stopPropagation(); openSettingsDialog(lbSettings); });
btnSettingsClose?.addEventListener('click', closeSettingsPanel);
btnSettingsDone?.addEventListener('click', closeSettingsPanel);
settingsOverlay?.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettingsPanel(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOverlay && settingsOverlay.style.display !== 'none') closeSettingsPanel();
});
document.getElementById('lbNewChat')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeSettingsPanel();
  document.querySelector('.fx-nc-listbtn')?.click(); // the footer's "＋ New chat" menu
});

// Expand/Collapse
btnClose.addEventListener('click', () => window.electronAPI.closeWindow());

// Maximize / restore: title-bar button, double-click on the title bar, Ctrl+Shift+M
(() => {
  const btnMax = document.getElementById('btnMax');   // title bar (hidden in Shelter)
  const tbMax = document.getElementById('tbMax');     // chat toolbar
  const api = window.electronAPI;
  if (!api.toggleMaximize) { btnMax?.remove(); tbMax?.remove(); return; }
  const show = (on) => {
    document.body.classList.toggle('hud-maximized', !!on);
    const what = (on ? 'Restore size' : 'Maximize') + ' (Ctrl+Shift+M)';
    if (btnMax) {
      btnMax.innerHTML = on
        ? '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="0.6" y="2.6" width="7.8" height="7.8"/><path d="M2.6 2.6V0.6h7.8v7.8H8.4"/></svg>'
        : '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="0.6" y="0.6" width="9.8" height="9.8"/></svg>';
      btnMax.title = what + ', or double-click the title bar';
    }
    if (tbMax) { tbMax.textContent = on ? 'Restore' : 'Maximize'; tbMax.title = what; }
  };
  const toggle = async () => show(await api.toggleMaximize());
  btnMax?.addEventListener('click', toggle);
  tbMax?.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  show(false);
  api.onMaximized?.(show);
  document.querySelector('.pill-header')?.addEventListener('dblclick', (e) => {
    if (!e.target.closest('button, input, textarea, a, .quick-chip')) toggle();
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); toggle(); }
  });
})();
// Shelter has no title bar: its ⏻ key at the end of the contact-list toolbar quits
document.getElementById('lbQuit')?.addEventListener('click', () => window.electronAPI.closeWindow());

// Tab Filters
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderSessionCards(true);
  });
});

// Test nudge button (silent shake + glow, as if a session just finished)
document.getElementById('btnTestNudge')?.addEventListener('click', () => {
  window.electronAPI.testNudge();
});

// Test alert button
btnTest.addEventListener('click', () => {
  window.soundSynth.playAttention();
  const dummyAlert = {
    id: 'test_session_' + Date.now(),
    source: 'claude',
    project: 'test-project',
    status: 'idle',
    statusLabel: 'Idle (Question)',
    state: 'attention',
    title: 'Claude asks for confirmation',
    detail: 'I prepared the update with user bubble and image support. Proceed?',
    fullContent: '### Visual Update Ready\n\n- User speech bubbles render directly in the dialog.\n- Image attachments supported via 📎, Ctrl+V, or drag-and-drop.\n\nWould you like to test it?',
    isQuestion: true,
    mtime: Date.now(),
    unread: true,
    timestamp: new Date().toISOString()
  };
  sessionsList.unshift(dummyAlert);
  renderAll();
  showDetailView(dummyAlert);
});

// "claude-opus-5-5" -> "Opus 5.5", "claude-sonnet-4-5-20250929" -> "Sonnet 4.5",
// "gemini-4-argon-medium" -> "Gemini 4 Argon", "gpt-oss-120b-medium" -> "GPT-OSS 120B"
function formatModelName(model) {
  if (!model) return '';
  const raw = String(model).trim();
  const id = raw.toLowerCase().replace(/^claude-/, '').replace(/\[.*\]$/, '');
  const m = id.match(/^([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:-(?:low|medium|high|xhigh|max|thinking))?$/);
  if (m && ['opus', 'sonnet', 'haiku', 'fable'].includes(m[1])) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return `${family} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
  }
  const gm = id.match(/^gemini-(\d+(?:\.\d+)?)-([a-z0-9-]+?)(?:-(?:low|medium|high|xhigh|max|thinking))?$/);
  if (gm) {
    const variant = gm[2].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `Gemini ${gm[1]} ${variant}`;
  }
  const gpt = id.match(/^gpt-oss-(\d+b)(?:-(?:low|medium|high|xhigh|max))?$/);
  if (gpt) return `GPT-OSS ${gpt[1].toUpperCase()}`;
  return raw;
}

// Returns "Opus 5.5 · medium" (or '' when unknown)
function formatModelEffort(session) {
  if (!session) return '';
  const name = formatModelName(session.model);
  if (!name) return '';
  return session.effort ? `${name} · ${session.effort}` : name;
}

// Small chip showing model + effort; hidden when unknown
function renderModelChip(el, session) {
  const label = formatModelEffort(session);
  el.textContent = label;
  el.title = session?.model ? `Model: ${session.model}${session.effort ? `\nEffort: ${session.effort}` : ''}` : '';
  const where = el.classList.contains('rt-model') ? ' rt-model' : ''; // the one in the input toolbar
  el.className = `model-chip${where} ${session?.effort ? 'effort-' + session.effort : ''}`;
  if (where && !label && session && (session.source === 'claude' || session.source === 'antigravity')) {
    el.textContent = 'Model ▾'; // nothing known yet: still the way into the Model menu
    el.style.display = '';
    return;
  }
  el.style.display = label ? '' : 'none';
  if (where && label) el.textContent = label + ' ▾';
}

// Time ago
function formatTimeAgo(mtime) {
  const diffSec = Math.floor((Date.now() - mtime) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  return `${diffHour}h ago`;
}

// Render everything
function renderAll() {
  updateHeader();
  renderQuickChips();
  renderSessionCards();
  renderRunningStrip();
}

// ---- Collapsed view: small card per running session under the title bar ----
const STRIP = { cardH: 30, gap: 4, padTop: 2, padBottom: 8, moreH: 16, maxCards: 4 };
let lastStripExtra = -1;

function renderRunningStrip() {
  const strip = document.getElementById('runningStrip');
  if (!strip) return;
  const running = sessionsList.filter((s) => s.status === 'running');
  const shown = running.slice(0, STRIP.maxCards);
  const more = running.length - shown.length;

  strip.innerHTML = '';
  for (const s of shown) {
    const card = document.createElement('div');
    card.className = 'run-card';
    card.title = `${s.project} — ${s.sessionTitle || ''}\nClick to open`;

    const pic = document.createElement('div');
    pic.className = 'run-pic';
    setRobotAvatar(pic, s);

    const title = document.createElement('span');
    title.className = 'run-title';
    title.textContent = s.sessionTitle || s.project;

    const status = document.createElement('span');
    status.className = 'run-status';
    status.textContent = friendlyStatus(s, 'running');

    card.append(pic, title, status);
    card.addEventListener('click', (e) => { e.stopPropagation(); showDetailView(s); });
    strip.appendChild(card);
  }
  if (more > 0) {
    const m = document.createElement('div');
    m.className = 'run-more';
    m.textContent = `+${more} more running`;
    m.addEventListener('click', () => { showListView(); setExpanded(true); });
    strip.appendChild(m);
  }

  // Height the collapsed window needs for this strip (computed, not measured,
  // so it's right even while the strip is hidden in the expanded view)
  const extra = shown.length
    ? STRIP.padTop + shown.length * STRIP.cardH + (shown.length - 1) * STRIP.gap +
      (more > 0 ? STRIP.gap + STRIP.moreH : 0) + STRIP.padBottom
    : 0;
  strip.classList.toggle('empty', !shown.length);
  if (extra !== lastStripExtra) {
    lastStripExtra = extra;
    stripExtra = extra;
    pushCompactExtra(); // strip + approval toasts
  }
  renderApprovalToasts(); // keeps project names on toasts fresh
}

// Mini edge tab: orange = needs input, blue = running, green = all idle
function updateMiniDock(attentionList, runningList) {
  const mini = document.getElementById('miniDock');
  const count = document.getElementById('miniCount');
  if (!mini || !count) return;
  let state = 'ready';
  let n = 0;
  let tip = 'All sessions idle';
  if (attentionList.length) {
    state = 'attention'; n = attentionList.length;
    tip = `${attentionList[0].project}: needs input`;
  } else if (runningList.length) {
    state = 'running'; n = runningList.length;
    tip = `${runningList.length} running — ${runningList[0].project}: ${runningList[0].statusLabel || 'Running'}`;
  }
  mini.classList.remove('ready', 'running', 'attention');
  mini.classList.add(state);
  count.textContent = n;
  count.style.display = n ? '' : 'none';
  mini.title = `${tip}\nClick to open · drag to move`;
  miniLists = { attention: attentionList, running: runningList };
  updateMiniAvatar();
}

// Mini tab: the robot of the chat that matters most right now, and ✓ / ✕ for
// the oldest tool request waiting for approval.
// (`var`: also called from the approval code, which can run before this point)
var miniLists = { attention: [], running: [] };
var miniExtraSent = -1;
var miniLastChatId = null; // last conversation you opened
var MINI_APPROVE_W = 236; // px added to the docked tab for the request details + buttons
var MINI_UPDATE_W = 156;  // px added to the docked tab for the hot-reload Restart/Later UI
function updateMiniAvatar() {
  const mini = document.getElementById('miniDock');
  const icon = mini?.querySelector('.mini-icon');
  const orb = mini?.querySelector('.mini-orb');
  const box = document.getElementById('miniApprove');
  if (!mini || !icon || !orb || !box) return;

  const pending = typeof pendingApprovals !== 'undefined' && pendingApprovals ? [...pendingApprovals.values()] : [];
  const req = pending[0] || null;
  const byId = (id) => sessionsList.find((x) => x.id === id);
  const recent = [...sessionsList].sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0];
  // the chat you have open (or opened last); without one, the one that matters most right now
  const cur = typeof currentActiveSession !== 'undefined' ? currentActiveSession : null;
  if (cur) miniLastChatId = cur.id;
  const last = !cur && miniLastChatId ? byId(miniLastChatId) : null;
  const s = cur || last || (req && byId(req.sessionId)) || miniLists.attention[0] || miniLists.running[0] || recent || null;

  if (s) {
    setRobotAvatar(icon, s);
    orb.classList.add('robot');
  } else if (orb.classList.contains('robot')) {
    orb.classList.remove('robot');
    icon.classList.remove('has-robot');
    icon.textContent = '✦';
  }

  mini.classList.toggle('has-approval', !!req);
  box.style.display = req ? '' : 'none';
  if (req) {
    const rs = byId(req.sessionId);
    const who = rs ? agentLabel(rs.source, rs.id) : 'Agent';
    const what = `${who} wants to use ${prettyToolName(req.toolName)}` +
      `${rs ? ' — ' + rs.project : ''}\n${describeToolInput(req.toolName, req.input)}`;
    const more = pending.length > 1 ? `\n(${pending.length - 1} more waiting)` : '';
    // details shown on the tab itself, before the buttons
    const head = document.getElementById('miniDetHead');
    head.textContent = '';
    head.append(`${who} wants to use `);
    const tool = document.createElement('strong');
    tool.textContent = prettyToolName(req.toolName);
    head.append(tool);
    document.getElementById('miniDetCmd').textContent = describeToolInput(req.toolName, req.input) || '';
    document.getElementById('miniDetMeta').textContent =
      [rs?.project, pending.length > 1 ? `+${pending.length - 1} more waiting` : ''].filter(Boolean).join(' · ');
    document.getElementById('miniAllow').title = `Allow\n${what}${more}`;
    document.getElementById('miniDeny').title = `Deny\n${what}${more}`;
    mini.title = `${what}${more}\nClick the robot to open · drag to move`;
  }
  const hasHot = !req && document.body.classList.contains('has-hot-update');
  mini.classList.toggle('has-hot-update', hasHot);
  const extra = req ? MINI_APPROVE_W : (hasHot ? MINI_UPDATE_W : 0);
  if (extra !== miniExtraSent) {
    miniExtraSent = extra;
    window.electronAPI.setMiniExtra?.(extra);
  }
}
(() => {
  const answer = (choice) => (e) => {
    e.stopPropagation();
    const req = [...pendingApprovals.values()][0];
    if (req) answerApproval(req, choice);
    updateMiniAvatar();
  };
  document.getElementById('miniAllow')?.addEventListener('click', answer('allow'));
  document.getElementById('miniDeny')?.addEventListener('click', answer('deny'));
})();

// Badge orb shows C / A for the open conversation, ✦ in overview
function setHeaderIdentity(session) {
  const inDetail = !!session;
  document.body.classList.toggle('in-detail', inDetail);
  renderApprovalToasts();
  if (inDetail) {
    setRobotAvatar(badgeIcon, session);
    primaryBadge.className = `agent-badge ${session.source}`;
    primaryBadge.title = session.source === 'claude' ? 'Claude Code' : 'Antigravity';
  } else {
    badgeIcon.classList.remove('has-robot');
    badgeIcon.textContent = '✦';
    primaryBadge.className = 'agent-badge multi';
    primaryBadge.title = 'Active AI Sessions';
  }
}

// Update Top Header Pill
function updateHeader() {
  const total = sessionsList.length;
  const runningList = sessionsList.filter(s => s.status === 'running');
  const idleList = sessionsList.filter(s => s.status === 'idle');
  const attentionList = sessionsList.filter(s => s.state === 'attention' && s.unread);

  badgeCount.textContent = `${total} AI${total === 1 ? '' : 's'}`;
  countAll.textContent = total;
  if (countRunning) countRunning.textContent = runningList.length;
  if (countIdle) countIdle.textContent = idleList.length;
  if (countAttention) countAttention.textContent = attentionList.length;

  // MSN-style "My Status" + mail strip at the top of the contact list
  const msnName = document.getElementById('msnName');
  if (msnName) {
    const needN = attentionList.length;
    msnName.textContent = runningList.length ? `${runningList.length} running` : 'All quiet';
    document.getElementById('msnState').textContent = needN ? '(Busy)' : runningList.length ? '(Online)' : '(Away)';
    const mail = document.getElementById('msnMail');
    mail.textContent = needN ? `${needN} session${needN === 1 ? '' : 's'} need${needN === 1 ? 's' : ''} you` : 'No sessions need you';
    mail.classList.toggle('alert', needN > 0);
  }

  updateMiniDock(attentionList, runningList);

  // Model/effort chip follows whichever session the header is describing
  if (headerModel) {
    const focus = currentActiveSession || attentionList[0] || runningList[0] || null;
    renderModelChip(headerModel, focus);
  }

  // 1. If currently inspecting a session in Detail View, Header Pill MUST match that session!
  // Title bar mode: the open conversation's identity (agent orb, project,
  // model chip, status) lives up here instead of in a separate row.
  setHeaderIdentity(currentActiveSession);

  if (currentActiveSession) {
    const s = currentActiveSession;
    const isRunning = s.status === 'running';
    const isAttn = s.unread || s.state === 'attention';
    const state = isAttn ? 'attention' : (isRunning ? 'running' : 'idle');

    overlayCard.className = `overlay-card ${isAttn ? 'attention' : isRunning ? 'tool' : 'ready'}`;
    primaryDot.className = `status-indicator ${isAttn ? 'attention' : isRunning ? 'tool' : 'ready'}`;
    mainTitle.textContent = s.project;
    mainTitle.title = s.sessionTitle || s.project;
    mainSub.textContent = friendlyStatus(s, state);
    mainSub.title = s.statusLabel || '';
    return;
  }
  mainTitle.title = '';
  mainSub.title = '';

  // 2. Otherwise in List / Overview mode:
  if (attentionList.length > 0) {
    const primary = attentionList[0];
    overlayCard.className = 'overlay-card attention';
    primaryDot.className = 'status-indicator attention';
    mainTitle.textContent = `${primary.project}: Needs Input!`;
    mainSub.textContent = primary.detail || primary.title;
  } else if (runningList.length > 0) {
    const primary = runningList[0];
    overlayCard.className = 'overlay-card tool';
    primaryDot.className = 'status-indicator tool';
    mainTitle.textContent = `${primary.project}: Running`;
    mainSub.textContent = primary.statusLabel || primary.title;
  } else {
    overlayCard.className = 'overlay-card ready';
    primaryDot.className = 'status-indicator ready';
    mainTitle.textContent = total > 0 ? `${total} AI Sessions Idle` : 'AI HUD Idle';
    mainSub.textContent = total > 0 ? 'All sessions idle / waiting' : 'Listening for activity';
  }
}

// Render Quick Chips in Header
function renderQuickChips() {
  quickChips.innerHTML = '';
  sessionsList.slice(0, 4).forEach(session => {
    const chip = document.createElement('div');
    const isRunning = session.status === 'running';
    const isActive = currentActiveSession && currentActiveSession.id === session.id;
    chip.className = `quick-chip ${session.unread ? 'attention' : ''} ${isActive ? 'active' : ''}`;
    chip.title = `${session.source.toUpperCase()}: ${session.project} (${session.statusLabel || session.status})`;

    const dot = document.createElement('div');
    dot.className = `chip-dot ${session.unread ? 'attention' : (isRunning ? 'tool' : 'ready')}`;

    const text = document.createElement('span');
    const prefix = session.source === 'claude' ? 'C' : 'A';
    text.textContent = `${prefix}:${session.project.slice(0, 7)} [${isRunning ? '▶' : '⏸'}]`;

    chip.appendChild(dot);
    chip.appendChild(text);

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      showDetailView(session);
    });

    quickChips.appendChild(chip);
  });
}

// Render Expanded Session Cards
function renderSessionCards(force = false) {
  if (!force && window.getSelection) {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0 && sessionsContainer.contains(sel.anchorNode)) {
      return;
    }
  }
  sessionsContainer.innerHTML = '';

  let filtered = sessionsList;
  if (currentFilter === 'running') {
    filtered = sessionsList.filter(s => s.status === 'running');
  } else if (currentFilter === 'idle') {
    filtered = sessionsList.filter(s => s.status === 'idle');
  } else if (currentFilter === 'attention') {
    filtered = sessionsList.filter(s => s.state === 'attention');
  }

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '20px';
    empty.style.textAlign = 'center';
    empty.style.color = '#64748b';
    empty.style.fontSize = '12px';
    empty.textContent = 'No sessions matching this filter.';
    sessionsContainer.appendChild(empty);
    return;
  }

  // The model most sessions use; cards only mention a model when it differs
  const modelCounts = new Map();
  sessionsList.forEach((s) => { const m = formatModelEffort(s); if (m) modelCounts.set(m, (modelCounts.get(m) || 0) + 1); });
  commonModelText = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // Group by workspace (same cwd), keeping the priority order of sessionsList
  const groups = new Map();
  let sortedGroups;
  if (groupMode === 'status') {
    // Messenger style: Needs you / Running / Idle
    const order = [['attention', 'Needs you'], ['running', 'Running'], ['idle', 'Idle']];
    order.forEach(([k, label]) => groups.set(k, { key: 'status:' + k, name: label, cwd: '', sessions: [] }));
    filtered.forEach(s => {
      const st = (s.unread || s.state === 'attention') ? 'attention' : (s.status === 'running' ? 'running' : 'idle');
      groups.get(st).sessions.push(s);
    });
    sortedGroups = [...groups.values()].filter(g => g.sessions.length);
  } else {
    filtered.forEach(session => {
      const key = workspaceKey(session);
      if (!groups.has(key)) {
        groups.set(key, { key, name: session.project, cwd: session.cwd, sessions: [] });
      }
      groups.get(key).sessions.push(session);
    });
    // Groups in a stable alphabetical order (by workspace name, then path),
    // so they don't jump around when a session's status changes.
    sortedGroups = [...groups.values()].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true }) ||
      (a.key || '').localeCompare(b.key || '')
    );
  }

  // Vault "Free" layout (logic/vault/layout.js): rooms side by side, in your order
  if (window.vaultLayout) sortedGroups = window.vaultLayout.arrange(sortedGroups);
  sortedGroups.forEach(group => {
    // a chat open beside its robot (focus.js): its room shows while it's open, even if folded or hidden
    const hasPinned = typeof vaultPinnedId !== 'undefined' && !!vaultPinnedId && group.sessions.some((x) => x.id === vaultPinnedId);
    const isCollapsed = collapsedGroups.has(group.key) && !hasPinned;
    const groupEl = document.createElement('div');
    groupEl.className = `workspace-group ${isCollapsed ? 'collapsed' : ''}`;
    if (hiddenRooms.has(group.key) && !hasPinned) groupEl.classList.add('vault-hidden'); // hidden in the Vault only (room right-click)

    const header = document.createElement('div');
    header.className = 'workspace-header';
    header.title = group.cwd || group.name;

    const caret = document.createElement('span');
    caret.className = 'workspace-caret';
    caret.textContent = '▾';

    const name = document.createElement('span');
    name.className = 'workspace-name';
    name.textContent = group.name;

    const runningN = group.sessions.filter(s => s.status === 'running').length;
    const attnN = group.sessions.filter(s => s.unread || s.state === 'attention').length;

    const stats = document.createElement('span');
    stats.className = 'workspace-stats';
    if (attnN) {
      const a = document.createElement('span');
      a.className = 'ws-stat attention';
      a.textContent = `● ${attnN}`;
      a.title = `${attnN} need${attnN === 1 ? 's' : ''} input`;
      stats.appendChild(a);
    }
    if (runningN) {
      const r = document.createElement('span');
      r.className = 'ws-stat running';
      r.textContent = `▶ ${runningN}`;
      r.title = `${runningN} running`;
      stats.appendChild(r);
    }
    // Messenger style "(running/total)"
    const count = document.createElement('span');
    count.className = 'ws-count';
    count.textContent = `(${runningN}/${group.sessions.length})`;
    count.title = `${runningN} running of ${group.sessions.length} session${group.sessions.length === 1 ? '' : 's'}`;
    stats.appendChild(count);

    header.appendChild(caret);
    header.appendChild(name);
    header.appendChild(stats);
    header.addEventListener('click', () => {
      if (collapsedGroups.has(group.key)) collapsedGroups.delete(group.key);
      else collapsedGroups.add(group.key);
      saveCollapsedGroups();
      renderSessionCards();
    });

    const body = document.createElement('div');
    body.className = 'workspace-body';
    // Needs your reply first, then running, then most recent
    const rank = (s) => (s.unread || s.state === 'attention' ? 0 : s.status === 'running' ? 1 : 2);
    const ordered = group.sessions
      .slice()
      .sort((a, b) => rank(a) - rank(b) || (b.mtime || 0) - (a.mtime || 0));
    ordered.forEach(session => body.appendChild(buildSessionCard(session)));

    const vaultRoom = typeof buildWorkspaceVaultRoom === 'function'
      ? buildWorkspaceVaultRoom(ordered, { name: group.name, key: group.key, cwd: group.cwd, runningN, attnN, total: group.sessions.length }) : null;
    groupEl.appendChild(header);
    if (vaultRoom) groupEl.appendChild(vaultRoom);
    groupEl.appendChild(body);
    window.vaultLayout?.place(groupEl, group.key);
    sessionsContainer.appendChild(groupEl);
  });
  // Vault: a note at the bottom when rooms are hidden, to bring them back
  const hiddenN = sortedGroups.filter((g) => hiddenRooms.has(g.key)).length;
  if (hiddenN) {
    const note = document.createElement('button');
    note.className = 'vault-hidden-note';
    note.textContent = `${hiddenN} hidden room${hiddenN === 1 ? '' : 's'} · Show`;
    note.title = 'Show the rooms you hid (right-click a room → Hide room)';
    note.addEventListener('click', (e) => { e.stopPropagation(); hiddenRooms.clear(); saveHiddenRooms(); renderSessionCards(true); });
    sessionsContainer.appendChild(note);
  }
  window.vaultLayout?.afterRender();
}

// How the contact list is grouped: by folder (default) or by status (remembered)
let groupMode = window.electronAPI.settings?.groupMode === 'status' ? 'status' : 'folder';
const lbGroupBtn = document.getElementById('lbGroup');
function syncGroupBtn() { if (lbGroupBtn) lbGroupBtn.textContent = groupMode === 'status' ? 'Group: Status' : 'Group: Folder'; }
syncGroupBtn();
lbGroupBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  groupMode = groupMode === 'status' ? 'folder' : 'status';
  window.electronAPI.storeSet('groupMode', groupMode);
  syncGroupBtn();
  renderSessionCards(true);
});

// Contact list as a List (rows) or a Grid (big avatar tiles) — remembered
let listViewMode = window.electronAPI.settings?.listView === 'list' ? 'list' : 'grid'; // grid unless you picked list
const lbViewBtn = document.getElementById('lbView');
function applyListView() {
  // Work style never shows the Vault (your saved choice is kept for the other styles)
  document.body.classList.toggle('list-grid', listViewMode === 'grid' && !document.body.classList.contains('style-work'));
  if (lbViewBtn) lbViewBtn.textContent = listViewMode === 'grid' ? 'View: Vault' : 'View: List';
}
applyListView();
lbViewBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  listViewMode = listViewMode === 'grid' ? 'list' : 'grid';
  window.electronAPI.storeSet('listView', listViewMode);
  applyListView();
});

// Same folder => same group (case/slash-insensitive for Windows paths)
function workspaceKey(session) {
  if (session.source === 'antigravity' && session.project === 'Antigravity') return 'antigravity:unknown';
  const cwd = (session.cwd || session.project || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  return cwd || session.project || 'unknown';
}

const collapsedGroups = new Set(window.electronAPI.settings?.collapsedGroups || []);
// rooms hidden from the Vault view (the List view still shows them)
const hiddenRooms = new Set(window.electronAPI.settings?.hiddenRooms || []);
function saveHiddenRooms() { window.electronAPI.storeSet('hiddenRooms', [...hiddenRooms]); }
function saveCollapsedGroups() {
  window.electronAPI.storeSet('collapsedGroups', [...collapsedGroups]);
}

// Vault view code lives in ui/logic/vault/ (rooms, robots, focus, room-build), loaded after this file.

function buildSessionCard(session) {
  // Compact contact-list style row:
  //  (orb)  Title ................................ 13m
  //         latest message preview (one line)
  //         Running Bash · Opus 5.5 medium
  const isAttn = session.unread || session.state === 'attention';
  const isRunning = session.status === 'running';
  const state = isAttn ? 'attention' : (isRunning ? 'running' : 'idle');
  const agentName = agentLabel(session.source, session.id);

  const row = document.createElement('div');
  row.id = `card-${session.id}`;
  row.className = `session-row state-${state} src-${session.source}`;
  const doneAgo = Date.now() - (justFinished.get(session.id) || 0);
  if (doneAgo < 5000) {
    row.classList.add('just-done');
    row.style.animationDelay = `-${doneAgo}ms`; // continue the glow across re-renders
  }
  row.addEventListener('click', () => {
    const sel = window.getSelection ? window.getSelection().toString() : '';
    if (sel && sel.length > 0) return; // don't open while selecting text
    showDetailView(session);
  });

  const orb = document.createElement('div');
  orb.className = 'row-orb';
  setRobotAvatar(orb, session);
  orb.title = agentName;

  const main = document.createElement('div');
  main.className = 'row-main';

  const line1 = document.createElement('div');
  line1.className = 'row-line1';
  const fullTitle = session.sessionTitle || session.aiTitle || 'Untitled session';
  const titleEl = document.createElement('span');
  titleEl.className = 'row-title';
  titleEl.textContent = fullTitle;
  titleEl.title = fullTitle;
  const timeEl = document.createElement('span');
  timeEl.className = 'row-time';
  timeEl.textContent = formatShortAgo(session.mtime);
  timeEl.title = new Date(session.mtime).toLocaleString();
  // Agent name (or your renamed one) in front of the title
  const agentEl = document.createElement('span');
  agentEl.className = `row-agent ${session.source === 'claude' ? 'claude' : 'antigravity'}`;
  agentEl.textContent = agentLabel(session.source, session.id);
  agentEl.title = session.source === 'claude' ? 'Claude Code' : 'Antigravity';
  line1.append(agentEl, titleEl, timeEl);

  // Messenger style: "Title — latest message" on one line
  const preview = document.createElement('span');
  preview.className = 'row-preview';
  preview.textContent = session.detail || '';
  preview.title = session.detail || '';
  if (preview.textContent) titleEl.after(preview);

  const meta = document.createElement('div');
  meta.className = 'row-meta';
  // Status only when it is not plain "idle" (the picture frame shows it too)
  if (state !== 'idle') {
    const statusEl = document.createElement('span');
    statusEl.className = 'row-status';
    statusEl.textContent = friendlyStatus(session, state);
    meta.appendChild(statusEl);
  }
  // Context fill: a thin bar under the title (amber ≥ 80%, red ≥ 95%);
  // the number is only spelled out when it is getting full
  let ctxBar = null;
  if (session.context?.window && session.context.used) {
    const pct = Math.round(session.context.pct);
    const level = pct >= 95 ? 'critical' : pct >= 80 ? 'warning' : '';
    ctxBar = document.createElement('div');
    ctxBar.className = `row-ctxbar ${level} ${session.context.compacting ? 'compacting' : ''}`;
    ctxBar.title = `Context: ${fmtTokens(session.context.used)} of ${fmtTokens(session.context.window)} tokens (${pct}%)`;
    const fill = document.createElement('div');
    fill.className = 'row-ctxfill';
    fill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
    ctxBar.appendChild(fill);
    if (level || session.context.compacting) {
      const ctxEl = document.createElement('span');
      ctxEl.className = `row-ctx ${level}`;
      ctxEl.textContent = session.context.compacting ? 'compacting…' : `ctx ${pct}%`;
      meta.appendChild(ctxEl);
    }
  }
  const modelFull = formatModelEffort(session);
  const modelText = modelFull && modelFull !== commonModelText ? modelFull.replace(' · ', ' ') : '';
  if (modelText) {
    const modelEl = document.createElement('span');
    modelEl.className = 'row-model';
    modelEl.textContent = modelText;
    modelEl.title = session.model ? `Model: ${session.model}${session.effort ? `\nEffort: ${session.effort}` : ''}` : '';
    meta.appendChild(modelEl);
  }

  main.append(line1);
  if (ctxBar) main.append(ctxBar);
  main.append(meta); // hidden by CSS when empty
  row.append(orb, main);

  if (isAttn) {
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'row-dismiss';
    dismissBtn.textContent = '✕';
    dismissBtn.title = 'Dismiss';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      session.unread = false;
      window.electronAPI.dismissSession(session.id);
      renderAll();
    });
    row.appendChild(dismissBtn);
  }

  return row;
}

// ---- Robot avatars (robot_*.svg in the project root) ----
// Each session gets one robot, picked from a hash of its id so it never changes.
// Only robot_1 is used; each session gets its own colour instead.
const ROBOT_NAME = 'robot_1_small.svg';
const ROBOT_HUE_STEPS = 12; // 12 colours, 30° apart on the colour wheel

function sessionHash(session) {
  const key = String(session?.id || session?.project || '');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

// Body colours picked in the dress-up panel (session id -> hue), kept apart from
// outfits so "Use for all robots" never paints every robot the same colour
const robotHueOverrides = { ...(window.electronAPI.settings?.robotHues || {}) };
window.setRobotHue = function (id, hue) {
  if (!id) return;
  if (hue === null || hue === undefined) delete robotHueOverrides[id];
  else robotHueOverrides[id] = ((Math.round(hue) % 360) + 360) % 360;
  window.electronAPI.storeSet('robotHues', { ...robotHueOverrides });
  window.refreshRobotAvatars?.();
};
window.hasRobotHue = (id) => Object.prototype.hasOwnProperty.call(robotHueOverrides, id);

// Hue shift in degrees for this session (0 = the original blue). Stable per session,
// unless a colour was picked for it.
function robotHueFor(session) {
  const id = session?.id;
  if (id && Object.prototype.hasOwnProperty.call(robotHueOverrides, id)) return robotHueOverrides[id];
  return (sessionHash(session) % ROBOT_HUE_STEPS) * (360 / ROBOT_HUE_STEPS);
}

// Shift the hue of a #rrggbb colour, keeping its saturation & lightness
function shiftHexHue(hex, deg) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  h = (h + deg) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// ---- Headshot cropping ----
// The robots are full-body. We find the head automatically: render the SVG to a
// small canvas, measure the width of the drawing on each row, skip thin
// antennas at the top, and stop at the neck (width narrows) or the shoulders
// (width jumps). The crop is applied as a new SVG viewBox → stays sharp.
let headshotSvgPromise = null;      // Promise<cropped SVG text | null>
const robotColorUrls = new Map();   // hue -> blob URL (ready)
const robotColorPending = new Map(); // hue -> Promise<url | null>

function findHeadBox(img) {
  const W = 240;
  const H = Math.max(1, Math.round(W * img.naturalHeight / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  const rows = new Array(H);
  let maxW = 0;
  for (let y = 0; y < H; y++) {
    let minX = -1, maxX = -1;
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 40) { if (minX < 0) minX = x; maxX = x; }
    }
    const w = minX < 0 ? 0 : maxX - minX + 1;
    rows[y] = { minX, maxX, w };
    if (w > maxW) maxW = w;
  }
  if (!maxW) return null;

  const top = rows.findIndex((r) => r.w > 0);
  // Head starts where the drawing gets reasonably wide (skips antennas / dishes)
  let headStart = rows.findIndex((r) => r.w >= maxW * 0.3);
  if (headStart < 0) headStart = top;

  const minHeadRows = Math.round(H * 0.06);
  const searchEnd = Math.min(H - 1, headStart + Math.round(H * 0.6));
  let headMax = 0, neck = -1;
  for (let y = headStart; y <= searchEnd; y++) {
    const w = rows[y].w;
    if (y - headStart > minHeadRows && headMax > 0 &&
        (w < headMax * 0.7 || w > headMax * 1.35)) { neck = y; break; }
    if (w > headMax) headMax = w;
  }
  if (neck < 0) neck = Math.min(H - 1, headStart + Math.round(H * 0.35));

  const headH = neck - headStart;
  const y0 = Math.max(top, headStart - Math.round(headH * 0.18)); // a bit of antenna
  const y1 = Math.min(H - 1, neck + Math.round(headH * 0.06));
  let x0 = W, x1 = 0;
  for (let y = y0; y <= y1; y++) {
    if (rows[y].w) { x0 = Math.min(x0, rows[y].minX); x1 = Math.max(x1, rows[y].maxX); }
  }
  if (x1 <= x0) return null;

  // Square box with a little breathing room, centred on the head
  const size = Math.max(y1 - y0, x1 - x0) * 1.12;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const scale = img.naturalWidth / W; // canvas px → SVG units
  return { x: (cx - size / 2) * scale, y: (cy - size / 2) * scale, size: size * scale };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Cropped (headshot) SVG text of robot_1 — built once
function getHeadshotSvg() {
  if (!headshotSvgPromise) {
    headshotSvgPromise = (async () => {
      const svg = await window.electronAPI.readRobotSvg(ROBOT_NAME);
      if (!svg) return null;
      const fullUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        // The SVG may state its head box itself: data-headshot="x y size"
        const hint = svg.match(/data-headshot="\s*(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s*"/);
        const box = hint ? { x: +hint[1], y: +hint[2], size: +hint[3] } : findHeadBox(await loadImage(fullUrl));
        if (!box) return svg; // couldn't find the head → full robot
        const r = (n) => Math.round(n * 10) / 10;
        return svg
          .replace(/viewBox="[^"]*"/, `viewBox="${r(box.x)} ${r(box.y)} ${r(box.size)} ${r(box.size)}"`)
          .replace(/(<svg[^>]*?)\swidth="[^"]*"/, `$1 width="${r(box.size)}"`)
          .replace(/(<svg[^>]*?)\sheight="[^"]*"/, `$1 height="${r(box.size)}"`);
      } catch (e) {
        return svg;
      } finally {
        URL.revokeObjectURL(fullUrl);
      }
    })();
  }
  return headshotSvgPromise;
}

// Robot SVG text recoloured to a hue (every fill colour shifted), blink staggered,
// then dressed in the outfit (hat / glasses / clothes keep their own colours).
function styleRobotSvg(svg, hue, outfit) {
  let colored = hue ? svg.replace(/#[0-9a-fA-F]{6}\b/g, (hex) => shiftHexHue(hex, hue)) : svg;
  // Blinking eyelids: give each colour its own moment so the robots don't blink in sync
  const blinkDelay = -((hue / 30) * 1.73 % 5.2).toFixed(2);
  colored = colored.replace(/animation-delay:0s/g, `animation-delay:${blinkDelay}s`);
  if (outfit && typeof window.decorateRobotSvg === 'function') colored = window.decorateRobotSvg(colored, outfit);
  return colored;
}

// Full-body robot (no crop) for previews — e.g. the Dress-up panel
async function getRobotFullSvg(hue, outfit) {
  const svg = await window.electronAPI.readRobotSvg(ROBOT_NAME);
  return svg ? styleRobotSvg(svg, hue, outfit) : null;
}

// Headshot styled for (hue, outfit) → blob URL, cached per combination
function robotAvatarKey(hue, outfit) {
  return `${hue}|${outfit ? JSON.stringify(outfit) : ''}`;
}
function getRobotColorUrl(hue, outfit) {
  const key = robotAvatarKey(hue, outfit);
  if (!robotColorPending.has(key)) {
    robotColorPending.set(key, getHeadshotSvg().then((svg) => {
      if (!svg) return null;
      const url = URL.createObjectURL(new Blob([styleRobotSvg(svg, hue, outfit)], { type: 'image/svg+xml' }));
      robotColorUrls.set(key, url);
      return url;
    }));
  }
  return robotColorPending.get(key);
}

// Put the session's coloured robot headshot inside `el` (replaces the C / A letter).
// For the first moment after launch, the plain robot with a CSS hue filter is shown.
function setRobotAvatar(el, session) {
  const hue = robotHueFor(session);
  const outfit = typeof window.robotOutfitFor === 'function' ? window.robotOutfitFor(session) : null;
  const key = robotAvatarKey(hue, outfit);
  let img = el.querySelector('img.robot-avatar');
  if (!img) {
    el.textContent = '';
    img = document.createElement('img');
    img.className = 'robot-avatar';
    img.alt = '';
    img.draggable = false;
    el.appendChild(img);
  }
  el.classList.add('has-robot');
  img.dataset.hue = key;

  const ready = robotColorUrls.get(key);
  if (ready) {
    img.style.filter = '';
    if (img.getAttribute('src') !== ready) img.setAttribute('src', ready);
    return;
  }
  // Temporary: full robot tinted with a filter until the recoloured headshot is ready
  if (!img.getAttribute('src')) {
    img.setAttribute('src', `../${ROBOT_NAME}`);
    img.style.filter = hue ? `hue-rotate(${hue}deg)` : '';
  }
  getRobotColorUrl(hue, outfit).then((url) => {
    if (url && img.dataset.hue === key) {
      img.style.filter = '';
      img.setAttribute('src', url);
    }
  });
}

// Warm the cache at startup (crop once; colours are made on demand)
getHeadshotSvg();

// "Running (Thinking...)" → "Thinking…", "Idle (Ready)" → "Idle", etc.
function friendlyStatus(session, state) {
  if (state === 'attention') return 'Needs your input';
  const label = session.statusLabel || '';
  if (state === 'running') {
    if (session.context?.compacting) return 'Compacting conversation…';
    let m;
    if ((m = label.match(/^Running:\s*(.+)$/))) return `Running ${m[1]}`;
    if ((m = label.match(/^Running \(Analyzing (.+)\)$/))) return `Reading ${m[1]} output`;
    if (/Generating/i.test(label)) return 'Writing…';
    return 'Thinking…';
  }
  if (/not received/i.test(label)) return 'Message not received';
  if (/needs approval/i.test(label)) return 'Stopped — command needs approval';
  if (/Error/i.test(label)) return 'Stopped with an error';
  if (/No activity/i.test(label)) return 'Idle · no activity';
  return 'Idle';
}

// "now", "13m", "2h", "3d"
function formatShortAgo(mtime) {
  const s = Math.max(0, Math.floor((Date.now() - mtime) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// IPC Subscriptions
window.electronAPI.onSessionsSync((sessions) => {
  sessionsList = sessions;
  renderAll();

  if (currentActiveSession) {
    const updated = sessions.find(s => s.id === currentActiveSession.id);
    if (updated) {
      currentActiveSession = updated;

      detailProject.textContent = updated.project;
      renderModelChip(detailModel, updated);
      updateConvoHeader(updated);

      if (updated.unread || updated.state === 'attention') {
        detailStatusPill.className = 'status-pill attention';
        detailStatusPill.innerHTML = '<span class="dot-attention"></span> Needs Input';
      } else if (updated.status === 'running') {
        detailStatusPill.className = 'status-pill running';
        detailStatusPill.innerHTML = `<span class="dot-running"></span> ${updated.statusLabel || 'Running'}`;
      } else {
        detailStatusPill.className = 'status-pill idle';
        detailStatusPill.innerHTML = `<span class="dot-idle"></span> ${updated.statusLabel || 'Idle'}`;
      }

      // Keep the open conversation live. While the session works (or waits for
      // you), one "live" assistant message at the bottom is updated in place;
      // once the turn ends it becomes a normal message. A HUD-sent reply has its
      // own streaming bubble, so don't interfere with that.
      resyncOpenChat();
    }
  }
});

// Draw the open chat's newest record if it has not been drawn yet. Compares with
// what was actually DRAWN (syncedRecord), so a sync that had to wait for the
// HUD's own streaming bubble is retried instead of being lost.
function resyncOpenChat() {
  const cur = currentActiveSession;
  if (!cur || !detailView.classList.contains('active')) return;
  const updated = sessionsList.find((x) => x.id === cur.id);
  if (!updated || !updated.fullContent) return;
  if (document.getElementById('streamingBubble')) return; // a HUD reply is still streaming — retry when it ends
  if (syncedRecord.get(updated.id) === updated.lastRecordId) return;
  syncedRecord.set(updated.id, updated.lastRecordId);
  if (resyncFromDisk.has(updated.id)) { redrawInLogOrder(updated); return; }
  // A message typed somewhere else (remote control, VS Code, a terminal) is only in the
  // transcript: pull it in first so its "You said" box shows before the reply.
  redrawIfRemoteMessages(updated).then((redrawn) => { if (!redrawn) syncLiveMessage(updated); });
}

// Messages sent while the agent was busy (see submitReply): draw the chat in the
// transcript's order, so each reply sits under the message it answers.
var resyncFromDisk = new Set();
async function redrawInLogOrder(s) {
  let msgs = null;
  try { msgs = await window.electronAPI.getSessionHistory(s.id); } catch (e) {}
  if (currentActiveSession?.id !== s.id || document.getElementById('streamingBubble')) return;
  if (!msgs || !msgs.length) { syncLiveMessage(s); return; }
  const history = sessionChatHistory.get(s.id) || [];
  sessionChatHistory.set(s.id, history);
  await loadHistoryFromDisk(s, history, msgs);
  // The log joins a turn's texts into one reply; the live text is only its newest
  // piece. Already there → just mark it live; otherwise the log is a step behind.
  const shown = sessionChatHistory.get(s.id) || [];
  const last = shown[shown.length - 1];
  const newest = String(s.fullContent || '').trim();
  if (last && last.role === 'assistant' && newest && String(last.text || '').trim().endsWith(newest)) {
    last.live = s.status === 'running';
    last.el?.classList.toggle('live', last.live);
  } else if (!isPlaceholderText(newest)) {
    syncLiveMessage(s);
  }
  if (s.status !== 'running') resyncFromDisk.delete(s.id); // that turn is over
}

const normMsg = (t) => String(t || '').replace(/\s+/g, ' ').trim();
async function redrawIfRemoteMessages(s) {
  if ((s.source !== 'claude' && s.source !== 'antigravity') || !window.electronAPI.getSessionHistory) return false;
  let msgs = null;
  try { msgs = await window.electronAPI.getSessionHistory(s.id); } catch (e) { return false; }
  if (!msgs || !msgs.length) return false;
  if (currentActiveSession?.id !== s.id || document.getElementById('streamingBubble')) return false;
  const history = sessionChatHistory.get(s.id) || [];
  const local = history.filter((m) => m.role === 'user').map((m) => normMsg(m.text)).filter(Boolean);
  // the newest few user messages on disk that the chat has never shown
  const unseen = msgs.filter((m) => m.role === 'user').slice(-4).filter((m) => normMsg(m.text) && !local.some((l) => l === normMsg(m.text) || l.startsWith(normMsg(m.text)) || normMsg(m.text).startsWith(l)));
  if (!unseen.length) return false;
  sessionChatHistory.set(s.id, history);
  await loadHistoryFromDisk(s, history, msgs);
  return sessionChatHistory.get(s.id) !== history; // true when the chat was redrawn from disk
}

// (activity line, helper-agent team row and avatar jump: logic/chat/activity.js — loaded before this file)

// Text that is only a stand-in ("*Claude is thinking...*"), not a real reply
function isPlaceholderText(t) {
  const x = String(t || '').trim();
  return !x || /^\*[^*\n]{0,80}\*$/.test(x);
}

// Update (or add) the bottom assistant message of the open conversation
function syncLiveMessage(s) {
  if (s.placeholder) return; // nothing real to show yet — the activity line covers it
  const history = sessionChatHistory.get(s.id) || [];
  sessionChatHistory.set(s.id, history);
  const last = history[history.length - 1];
  const stillWorking = s.status === 'running';

  // Just sent a message: until the agent writes something new, its "latest text"
  // is still the PREVIOUS reply. Don't show that again as the new answer.
  if (last && last.role === 'user') {
    const prevReply = [...history].reverse().find((m) => m.role === 'assistant');
    const latest = normMsg(s.fullContent);
    const prev = prevReply ? normMsg(prevReply.text) : '';
    // whole previous reply, or a long piece of it (the log joins a turn's texts);
    // a short new answer like "Done." must not be mistaken for the old one
    if (latest && (prev === latest || (latest.length > 40 && prev.endsWith(latest)))) return;
  }

  if (last && last.role === 'assistant' && last.text === s.fullContent) {
    last.live = stillWorking;
    // The text is in history but no bubble was ever drawn for it (the HUD's
    // stream finished without showing one) — draw it now instead of waiting
    // for the chat to be reopened.
    if (!last.el || !last.el.isConnected) {
      last.el = appendBubble(last);
      last.fromStream = false;
      chatStream.scrollTop = chatStream.scrollHeight;
    }
    last.live = stillWorking;
    last.el?.classList.toggle('live', stillWorking);
    return; // nothing new
  }

  // Only auto-scroll if the user was already at (or near) the bottom
  const nearBottom = chatStream.scrollHeight - chatStream.scrollTop - chatStream.clientHeight < 80;

  if (last && last.role === 'assistant' && (last.live || last.fromStream) && last.el && last.el.isConnected) {
    // Update the live message in place (also a reply the HUD just streamed — no duplicate bubble)
    last.fromStream = false;
    const shownBefore = last.text || '';
    last.text = s.fullContent;
    last.time = 'Just now';
    typeInto(last.el.querySelector('.bubble-content'), s.fullContent, last.el, shownBefore);
  } else {
    const msg = { role: 'assistant', text: s.fullContent, time: 'Just now', source: s.source };
    history.push(msg);
    msg.el = appendBubble(msg);
    typeInto(msg.el?.querySelector('.bubble-content'), s.fullContent, msg.el, '');
  }
  history[history.length - 1].live = stillWorking;
  // boxed "Claude is typing a message..." while it is still being written
  history[history.length - 1].el?.classList.toggle('live', stillWorking);
  if (nearBottom) chatStream.scrollTop = chatStream.scrollHeight;
}

// Live streaming output from Claude Code
if (window.electronAPI.onReplyStream) {
  window.electronAPI.onReplyStream(({ sessionId, statusLabel, text, activity }) => {
    if (activity) liveActivity.set(sessionId, { act: activity, at: Date.now() });
    if (currentActiveSession && currentActiveSession.id === sessionId) {
      if (statusLabel) {
        detailStatusPill.className = 'status-pill running';
        detailStatusPill.innerHTML = `<span class="dot-running"></span> ${statusLabel}`;
        // Live status in the title bar
        mainSub.textContent = friendlyStatus({ statusLabel }, 'running');
        primaryDot.className = 'status-indicator tool';
      }
      updateConvoHeader({ ...currentActiveSession, status: 'running', state: 'tool', unread: false, statusLabel: statusLabel || currentActiveSession.statusLabel });

      // The reply bubble only appears once there is real text to show
      const real = !isPlaceholderText(text);
      let streamBubble = document.getElementById('streamingBubble');
      if (!streamBubble && real) {
        streamBubble = appendBubble({
          id: 'streamingBubble',
          role: 'assistant',
          text,
          time: 'Generating...',
          source: currentActiveSession.source
        });
        typeInto(streamBubble?.querySelector('.bubble-content'), text, streamBubble, '');
      } else if (streamBubble && real) {
        streamBubble.classList.remove('pending');
        typeInto(streamBubble.querySelector('.bubble-content'), text, streamBubble);
      }
      if (real) chatStream.scrollTop = chatStream.scrollHeight;
    }
  });
}

// Reply completion or status change
if (window.electronAPI.onReplyStatus) {
  window.electronAPI.onReplyStatus(({ sessionId, status, statusLabel, text, message }) => {
    if (message) {
      replyStatusMsg.textContent = message;
      if (status === 'idle') {
        setTimeout(() => {
          if (replyStatusMsg.textContent === message) replyStatusMsg.textContent = '';
        }, 4000);
      }
    }

    if (status === 'idle') {
      const streamBubble = document.getElementById('streamingBubble');
      liveActivity.delete(sessionId);
      if (streamBubble) {
        streamBubble.removeAttribute('id');
        if (text && !isPlaceholderText(text)) streamBubble.classList.remove('pending');
        else if (streamBubble.classList.contains('pending')) streamBubble.remove();
        const meta = streamBubble.querySelector('.bubble-meta');
        if (meta && currentActiveSession) {
          const agentName = agentLabel(currentActiveSession.source);
          setBubbleMeta(meta, agentName, 'Just now');
        }
        if (text) {
          typeInto(streamBubble.querySelector('.bubble-content'), text, streamBubble);
        }
      }

      if (text && sessionId) {
        const history = sessionChatHistory.get(sessionId) || [];
        history.push({
          role: 'assistant',
          text,
          time: 'Just now',
          source: (sessionsList.find((x) => x.id === sessionId) || currentActiveSession)?.source || 'claude',
          fromStream: true,
          el: streamBubble && streamBubble.isConnected ? streamBubble : undefined
        });
        sessionChatHistory.set(sessionId, history);
      }

      if (currentActiveSession && currentActiveSession.id === sessionId) {
        detailStatusPill.className = 'status-pill idle';
        detailStatusPill.innerHTML = `<span class="dot-idle"></span> ${statusLabel || 'Idle (Ready)'}`;
        syncedRecord.delete(sessionId);
        resyncOpenChat(); // show the final message / "needs input" now that the stream bubble is gone
      }
      // No chime here: finishing is signalled by the silent nudge (session-nudge)
    }
  });
}

window.electronAPI.onSessionAlert((session) => {
  window.soundSynth.playAttention();
  showDetailView(session);
});

// (reply options, slash commands and menu, new chat: logic/chat/slash.js; MCP panel: logic/nav/mcp-panel.js — loaded right after this file)

// ---- Tool approval prompts ----
// `var` so view code that runs before this line (syncHeaderMode at start-up) can safely check it
var pendingApprovals = new Map(); // id -> request (kept so they survive view switches)

function describeToolInput(toolName, input = {}) {
  if (input.command) return input.command;
  if (input.file_path) return input.file_path;
  if (input.url) return input.url;
  if (input.pattern) return input.pattern;
  try {
    const json = JSON.stringify(input, null, 2);
    return json.length > 600 ? json.slice(0, 600) + '\n…' : json;
  } catch (e) { return ''; }
}

function prettyToolName(toolName) {
  const m = toolName.match(/^mcp__(.+?)__(.+)$/);
  return m ? `${m[1]} › ${m[2]}` : toolName;
}

function renderApprovalCard(req) {
  if (document.getElementById(`perm-${req.id}`)) return;
  const card = document.createElement('div');
  card.className = 'perm-card';
  card.id = `perm-${req.id}`;

  const head = document.createElement('div');
  head.className = 'perm-head';
  head.textContent = `${currentActiveSession?.source === 'antigravity' ? 'Antigravity' : 'Claude'} wants to use `;
  const tool = document.createElement('strong');
  tool.textContent = prettyToolName(req.toolName);
  head.appendChild(tool);

  const body = document.createElement('pre');
  body.className = 'perm-input';
  body.textContent = describeToolInput(req.toolName, req.input);

  const actions = document.createElement('div');
  actions.className = 'perm-actions';
  const mk = (label, choice, cls) => {
    const b = document.createElement('button');
    b.className = `btn-action ${cls}`;
    b.textContent = label;
    b.addEventListener('click', () => answerApproval(req, choice));
    return b;
  };
  actions.append(mk('Allow', 'allow', 'primary'));
  // Saved rule: this tool (or this command) in this folder, kept across restarts
  if (req.always) {
    const what = alwaysLabel(req);
    const still = (req.always.stillAsks || []).filter(Boolean);
    const b = mk(`Always allow ${what} here`, 'always', 'dismiss');
    b.title = `Allows this now and saves ${(req.always.prefixes || []).length > 1 ? 'rules' : 'a rule'} (Settings → Approval rules) ` +
      `so ${what} never asks again in ${req.always.folder}.` +
      (still.length ? `\n${still.map((x) => '“' + x + '”').join(', ')} in this command will still ask every time.` : '') +
      '\nChained commands run without asking only when every part is covered.';
    actions.append(b);
  }
  // Trust the folder: everyday shell commands here run without asking
  if (req.trustFolder) {
    const name = String(req.trustFolder.folder).split(/[\\/]/).filter(Boolean).pop() || req.trustFolder.folder;
    const b = mk(`Always allow all commands in “${name}”`, 'always-folder', 'dismiss perm-trust');
    b.title = `Allows this now and saves a rule (Settings → Approval rules) so everyday ${req.toolName} commands ` +
      `(build, test, edit, git status…) run without asking in ${req.trustFolder.folder}.\n` +
      'Still asks every time for: delete (rm, Remove-Item…), kill, downloads (curl, wget…), running unseen code (| sh, eval, $( )…), git push / reset --hard / clean.\n' +
      'Delete the rule in Settings → Approval rules to be asked about everything again.';
    actions.append(b);
  }
  actions.append(mk('Deny', 'deny', 'dismiss perm-deny'));

  card.append(head, body, actions);
  // Keep it above the live "typing" bubble
  const stream = document.getElementById('streamingBubble');
  if (stream && stream.parentNode === chatStream) chatStream.insertBefore(card, stream);
  else chatStream.appendChild(card);
  chatStream.scrollTop = chatStream.scrollHeight;
}

function resolveApprovalCard(id, text) {
  const card = document.getElementById(`perm-${id}`);
  if (!card) return;
  card.classList.add('resolved');
  const actions = card.querySelector('.perm-actions');
  if (actions) actions.innerHTML = `<span class="perm-result">${text}</span>`;
}

// “sed” + “grep”  /  “npm test”  /  Edit   (what an "Always allow" rule covers)
function alwaysLabel(req) {
  const list = (req.always?.prefixes || [req.always?.prefix || '']).filter(Boolean);
  return list.length ? list.map((p) => `“${p}”`).join(' + ') : prettyToolName(req.toolName);
}

// One answer path for the in-chat card, the notification toast and the Vault robot
function answerApproval(req, choice) {
  if (!pendingApprovals.has(req.id)) return;
  window.electronAPI.respondPermission(req.id, choice);
  pendingApprovals.delete(req.id);
  if (currentActiveSession) updateConvoHeader(currentActiveSession);
  resolveApprovalCard(req.id, choice === 'deny' ? 'Denied'
    : choice === 'always' ? `Allowed — rule saved: always allow ${alwaysLabel(req)} in this folder`
    : choice === 'always-folder' ? 'Allowed — rule saved: everyday commands run without asking in this folder (delete, kill, downloads and git push still ask)'
    : 'Allowed');
  renderApprovalToasts();
  renderSessionCards(true); // the robot puts its hand down
}

// Vault: the bubble beside a robot that is waiting for your OK (tool + command, Allow / Deny)
function buildRoomApproval(req, toLeft) {
  const b = document.createElement('span');
  b.className = `vault-ask${toLeft ? ' to-left' : ''}`;
  const tool = document.createElement('b');
  tool.className = 'va-tool';
  tool.textContent = `Wants to use ${prettyToolName(req.toolName)}`;
  const cmd = document.createElement('span');
  cmd.className = 'va-cmd';
  cmd.textContent = describeToolInput(req.toolName, req.input);
  cmd.title = cmd.textContent;
  const btns = document.createElement('span');
  btns.className = 'va-btns';
  const mk = (label, cls, choice) => {
    const x = document.createElement('button');
    x.className = cls;
    x.textContent = label;
    x.addEventListener('click', (e) => { e.stopPropagation(); answerApproval(req, choice); });
    return x;
  };
  btns.append(mk('✓ Allow', 'va-allow', 'allow'), mk('✕ Deny', 'va-deny', 'deny'));
  b.append(tool, cmd, btns);
  b.addEventListener('click', (e) => e.stopPropagation()); // clicking the bubble doesn't open the chat
  return b;
}

// Is this request's conversation open on screen right now?
function isApprovalInView(req) {
  // the Changes panel (logic/nav/git-diff.js) covers the chat → show it as a card on top instead
  return isExpanded && document.body.classList.contains('in-detail') && !document.body.classList.contains('gd-open') &&
    currentActiveSession?.id === req.sessionId;
}

// ---- Approval notifications ----
// A tool request never switches the view any more. Unless you are already
// looking at that conversation, it shows up as a toast under the title bar
// (in the collapsed bar too) with Allow / Deny / Open.
// (`var`: these are used by view code that can run before this point)
var TOAST = { h: 56, gap: 4, padTop: 2, padBottom: 6, moreH: 16, max: 2 };
var toastExtra = 0;
var stripExtra = 0;
var lastCompactExtra = -1;
function pushCompactExtra() {
  if (!TOAST) return; // not initialised yet
  const extra = stripExtra + toastExtra;
  if (extra !== lastCompactExtra) {
    lastCompactExtra = extra;
    window.electronAPI.setCompactExtra?.(extra);
  }
}

function renderApprovalToasts() {
  const box = document.getElementById('approvalToasts');
  if (!box || !pendingApprovals || !TOAST) return;
  const list = [...pendingApprovals.values()].filter((r) => !isApprovalInView(r));
  const shown = list.slice(-TOAST.max).reverse(); // newest first
  const more = list.length - shown.length;
  box.innerHTML = '';

  for (const req of shown) {
    const s = sessionsList.find((x) => x.id === req.sessionId);
    const agent = s?.source === 'antigravity' ? 'Antigravity' : 'Claude';
    const t = document.createElement('div');
    t.className = 'perm-toast';
    t.title = `${s ? s.project + ' — ' + (s.sessionTitle || '') + '\n' : ''}${describeToolInput(req.toolName, req.input)}`;

    const top = document.createElement('div');
    top.className = 'toast-top';
    const ico = document.createElement('span');
    ico.className = 'toast-ico';
    ico.textContent = '!';
    const head = document.createElement('span');
    head.className = 'toast-head';
    head.append(`${agent} wants to use `);
    const strong = document.createElement('strong');
    strong.textContent = prettyToolName(req.toolName);
    head.appendChild(strong);
    const proj = document.createElement('span');
    proj.className = 'toast-proj';
    proj.textContent = s ? s.project : '';
    top.append(ico, head, proj);

    const bottom = document.createElement('div');
    bottom.className = 'toast-bottom';
    const cmd = document.createElement('span');
    cmd.className = 'toast-cmd';
    cmd.textContent = describeToolInput(req.toolName, req.input);
    const mk = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = `toast-btn ${cls}`;
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    bottom.append(
      cmd,
      mk('Allow', 'allow', () => answerApproval(req, 'allow')),
      mk('Deny', 'deny', () => answerApproval(req, 'deny')),
      mk('Open', 'open', () => {
        if (s) { showDetailView(s); setExpanded(true); }
        renderApprovalToasts();
      })
    );
    t.append(top, bottom);
    box.appendChild(t);
  }
  if (more > 0) {
    const m = document.createElement('div');
    m.className = 'toast-more';
    m.textContent = `+${more} more waiting for approval`;
    box.appendChild(m);
  }
  box.classList.toggle('empty', !shown.length);
  updateMiniAvatar(); // ✓ / ✕ on the docked mini tab

  toastExtra = shown.length
    ? TOAST.padTop + shown.length * TOAST.h + (shown.length - 1) * TOAST.gap +
      (more > 0 ? TOAST.gap + TOAST.moreH : 0) + TOAST.padBottom
    : 0;
  pushCompactExtra();
}

if (window.electronAPI.onPermissionRequest) {
  window.electronAPI.onPermissionRequest((req) => {
    if (req.toolName === 'ExitPlanMode' && window.handlePlanRequest) { window.handlePlanRequest(req); return; }
    if (req.toolName === 'AskUserQuestion' && window.handleQuestionRequest) { window.handleQuestionRequest(req); return; }
    pendingApprovals.set(req.id, req);
    window.soundSynth.playAttention();
    // Only draw the in-chat card if that conversation is already open;
    // otherwise it appears when you open it. Never switch view.
    if (currentActiveSession?.id === req.sessionId) renderApprovalCard(req);
    renderApprovalToasts();
    renderSessionCards(true); // its robot stops and raises a hand in the Vault
    const box = document.getElementById('approvalToasts');
    box?.classList.remove('flash'); void box?.offsetWidth; box?.classList.add('flash');
    if (currentActiveSession) updateConvoHeader(currentActiveSession);
  });
  window.electronAPI.onPermissionExpired(({ id }) => {
    pendingApprovals.delete(id);
    resolveApprovalCard(id, 'Expired');
    renderApprovalToasts();
    renderSessionCards(true);
    if (currentActiveSession) updateConvoHeader(currentActiveSession);
  });
}

// ---- Messenger-style conversation header, display pictures & info bar ----
function updateConvoHeader(s) {
  if (!s) return;
  updateMiniAvatar(); // mini tab shows the open chat's robot
  const isAttn = s.unread || s.state === 'attention';
  const isRunning = s.status === 'running';
  const state = isAttn ? 'attention' : (isRunning ? 'running' : 'idle');
  const agent = agentLabel(s.source, s.id);

  const dpAgent = document.getElementById('dpAgent');
  const dpImg = document.getElementById('dpAgentImg');
  dpAgent.className = `dp-frame state-${state}`;
  dpAgent.title = `${agent} — ${friendlyStatus(s, state)}`;
  dpImg.className = `dp-img dp-${s.source}`;
  setRobotAvatar(dpImg, s);

  const convoNameEl = document.getElementById('convoName');
  if (!convoNameEl.querySelector('input')) convoNameEl.textContent = agent; // not while you are renaming it
  document.getElementById('convoStatus').textContent = friendlyStatus(s, state); // the ( ) come from CSS (Classic only)
  convoNameEl.closest('.convo-contact')?.setAttribute('data-state', state); // Shelter colours the header by state
  renderModelChip(document.getElementById('convoModel'), s);
  const personal = document.getElementById('convoPersonal');
  personal.textContent = s.sessionTitle || s.project || '';
  personal.title = s.sessionTitle ? `${s.sessionTitle}\n${s.cwd || ''}` : (s.cwd || '');

  // Context meter
  const ctx = s.context;
  const ctxBox = document.getElementById('convoContext');
  if (ctx && ctx.window && ctx.used) {
    const pct = Math.min(100, ctx.pct);
    const fill = document.getElementById('ctxFill');
    fill.style.width = `${Math.max(1, pct)}%`;
    fill.className = `ctx-fill ${pct >= 95 ? 'critical' : pct >= 80 ? 'warning' : ''} ${ctx.compacting ? 'compacting' : ''}`;
    document.getElementById('ctxLabel').textContent = ctx.compacting
      ? 'Compacting conversation…'
      : `Context ${fmtTokens(ctx.used)} / ${fmtTokens(ctx.window)} · ${Math.round(pct)}%`;
    ctxBox.title = `${ctx.used.toLocaleString()} of ${ctx.window.toLocaleString()} tokens in context.\n` +
      'Claude Code compacts automatically as it nears the limit (shaded zone), and sometimes earlier.';
    ctxBox.style.display = '';
  } else {
    ctxBox.style.display = 'none';
  }

  // Yellow info bar
  const bar = document.getElementById('convoInfoBar');
  const text = document.getElementById('convoInfoText');
  const waitingApproval = [...pendingApprovals.values()].some((r) => r.sessionId === s.id);
  const recentCompact = ctx?.lastCompact && Date.now() - ctx.lastCompact.at < 10 * 60 * 1000 ? ctx.lastCompact : null;
  let msg = '';
  // (While the agent works, the activity line above the input box says what
  //  it is doing — see renderActivity — so the yellow bar stays out of the way.)
  if (s.deliveryFailed) msg = `${agent} never showed your last message. Make sure its window is open with this conversation selected, then send again.`;
  else if (waitingApproval) msg = `${agent} needs your permission to use a tool — see below.`;
  else if (isAttn) msg = `${agent} is waiting for your reply.`;
  else if (isRunning || ctx?.compacting) msg = '';
  else if (recentCompact) {
    msg = `Context was compacted ${recentCompact.trigger === 'manual' ? 'manually' : 'automatically'}: ` +
      `${fmtTokens(recentCompact.preTokens)} → ${fmtTokens(recentCompact.postTokens)} tokens.`;
  }
  // While the AI is working the bar sits right above the input box with a
  // Windows 7 busy-ring icon; otherwise it stays under the contact header.
  const working = !!msg && !s.deliveryFailed && !waitingApproval && !isAttn && (ctx?.compacting || isRunning);
  bar.className = `convo-infobar ${s.deliveryFailed || waitingApproval || isAttn ? 'warn' : 'info'}` +
    `${ctx?.compacting ? ' compacting' : ''}${working ? ' working' : ''}`;
  const icon = document.getElementById('convoInfoIcon');
  if (icon) {
    icon.className = working ? 'infobar-icon busy' : 'infobar-icon';
    icon.textContent = working ? '' : 'i';
  }
  const home = document.getElementById(working ? 'infoBarHomeBottom' : 'infoBarHomeTop');
  if (home && home.nextElementSibling !== bar) home.after(bar);
  text.textContent = msg;
  bar.style.display = msg ? '' : 'none';
  renderActivity(s);

  // Toolbar actions apply to both Claude Code and Antigravity
  const isSupported = s.source === 'claude' || s.source === 'antigravity';
  document.querySelectorAll('.tb-claude').forEach((b) => { b.style.display = isSupported ? '' : 'none'; });
}

// Toolbar buttons → same as typing the slash command
function openSlashFor(text) {
  replyTextarea.value = text;
  replyTextarea.focus();
  slashIndex = 0;
  updateSlashMenu();
}
document.getElementById('tbModel')?.addEventListener('click', (e) => {
  if (currentActiveSession?.source === 'antigravity' && window.openAgyModelMenu) { e.stopPropagation(); window.openAgyModelMenu(); }
  else if (window.openClaudeModelMenu) { e.stopPropagation(); window.openClaudeModelMenu(); }
  else openSlashFor('/model ');
});
document.getElementById('tbNewChat')?.addEventListener('click', (e) => {
  if (window.openNewChatMenu) { e.stopPropagation(); window.openNewChatMenu(); } // Claude or Antigravity?
  else runHudCommand('/clear');
});
document.getElementById('btnSlash')?.addEventListener('click', () => openSlashFor('/'));

// Called whenever a conversation is opened
function onDetailOpened(session) {
  updateConvoHeader(session);
  hideSlashMenu();
  mcpPanel.style.display = 'none';
  closeUsagePanel();
  closeSettingsPanel();
  if (btnMcp) btnMcp.style.display = (session.source === 'claude' || session.source === 'antigravity') ? '' : 'none';
  renderReplyOptions();
  if (session.source === 'claude' || session.source === 'antigravity') loadSlashCommands(session.cwd, session.source); // warm the cache
  for (const req of pendingApprovals.values()) {
    if (req.sessionId === session.id) renderApprovalCard(req);
  }
}

// ===========================================================================
// Usage view (📊): tokens & cost from local Claude Code / Antigravity logs
// ===========================================================================
// Floating dropdown in the conversation toolbar — opening it never changes
// the current conversation or its scroll position.
const usagePanel = document.getElementById('usagePanel');
const usageView = usagePanel; // tooltip positioning host
const usageBody = document.getElementById('usageBody');
const usageTooltip = document.getElementById('usageTooltip');
const tbUsage = document.getElementById('tbUsage');

function fmtTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
  return String(n);
}
function fmtUSD(n) {
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}
function isUsagePanelOpen() {
  return usagePanel && usagePanel.style.display !== 'none';
}

function openUsagePanel() {
  mcpPanel.style.display = 'none';
  usagePanel.style.display = '';
  fitUsagePanel();
  tbUsage?.classList.add('open');
  loadUsage();
}

// The panel opens upward from the input box: keep its top below the toolbar
// (it used to slide under the address bar when the window is short or the
// activity card is showing). The body scrolls instead.
function fitUsagePanel() {
  if (!isUsagePanelOpen()) return;
  const host = usagePanel.offsetParent || usagePanel.parentElement;
  const toolbar = document.querySelector('#detailView .convo-toolbar');
  const ceiling = toolbar ? toolbar.getBoundingClientRect().bottom + 6 : 60;
  const room = host.getBoundingClientRect().top - 4 - ceiling;
  usagePanel.style.maxHeight = Math.max(160, Math.floor(room)) + 'px';
}
window.addEventListener('resize', fitUsagePanel);
new ResizeObserver(fitUsagePanel).observe(document.getElementById('activityRow') || document.body);

function closeUsagePanel() {
  if (!usagePanel) return;
  usagePanel.style.display = 'none';
  usageTooltip.style.display = 'none';
  tbUsage?.classList.remove('open');
}

async function loadUsage(refresh = false) {
  // Keep showing the previous numbers while re-reading, if any
  if (!usageBody.childElementCount) usageBody.appendChild(el('div', 'usage-empty', 'Reading usage…'));
  let data;
  try { data = await window.electronAPI.getUsage(refresh); } catch (e) { data = { error: e.message }; }
  if (!isUsagePanelOpen()) return;
  usageBody.innerHTML = '';
  if (!data || data.error) {
    usageBody.appendChild(el('div', 'usage-empty', `Couldn't read usage: ${data?.error || 'unknown error'}`));
    return;
  }
  if (data.claude.available || data.planLimits?.available) {
    usageBody.appendChild(renderPlanLimits(data.planLimits));
  }
  const showAg = typeof window.isAntigravityEnabled !== 'function' || window.isAntigravityEnabled();
  if (data.claude.available) usageBody.appendChild(renderUsageSection('claude', 'Claude Code', data.claude, data.days, 'replies'));
  if (showAg && data.antigravity.available) usageBody.appendChild(renderUsageSection('antigravity', 'Antigravity', data.antigravity, data.days, 'steps'));
  if (!data.claude.available && (!showAg || !data.antigravity.available)) {
    usageBody.appendChild(el('div', 'usage-empty', showAg ? 'No Claude Code or Antigravity logs found.' : 'No Claude Code logs found.'));
  }
  usageBody.appendChild(el('div', 'usage-footnote',
    'Plan limits come live from your Claude account (same as /usage). Token counts and charts are ' +
    'from local logs on this PC and include cache reads. Cost is the API-equivalent figure Claude Code ' +
    'records; subscriptions aren’t billed per token.'));
}

// "resets 5:40pm" today, "resets Nov 12, 10am" later
function fmtReset(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `resets ${time}` : `resets ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

// Plan limits — like `/usage`: one meter per limit, % used + reset time
function renderPlanLimits(pl) {
  const sec = el('section', 'usage-section usage-limits');
  sec.appendChild(el('h3', 'usage-h', 'Claude plan limits'));

  if (!pl || !pl.available) {
    const why = {
      'not-logged-in': 'Claude Code isn’t signed in with a Claude subscription on this PC.',
      'no-credentials': 'Couldn’t find Claude Code’s login on this PC.',
      'expired': 'Claude Code’s login has expired — open Claude Code once (it refreshes automatically), then ↻ Refresh.',
      'network': 'Couldn’t reach Anthropic to check your limits. ↻ Refresh to try again.',
      'no-data': 'Your account didn’t report any plan limits.',
    }[pl?.reason] || 'Plan limits are unavailable right now.';
    sec.appendChild(el('div', 'usage-note', why));
    return sec;
  }

  for (const lim of pl.limits) {
    const row = el('div', 'limit-row');
    const top = el('div', 'limit-top');
    top.appendChild(el('span', 'limit-label', lim.label));
    const pct = Math.round(lim.percent);
    top.appendChild(el('span', 'limit-pct', `${pct}% used`));
    row.appendChild(top);

    const track = el('div', 'limit-track');
    const fill = el('div', `limit-fill ${pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : ''}`);
    fill.style.width = `${Math.max(pct ? 1.5 : 0, pct)}%`;
    track.appendChild(fill);
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-valuenow', String(pct));
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-label', lim.label);
    row.appendChild(track);

    const reset = fmtReset(lim.resetsAt);
    if (reset) {
      const r = el('div', 'limit-reset', reset);
      r.title = new Date(lim.resetsAt).toLocaleString();
      row.appendChild(r);
    }
    sec.appendChild(row);
  }
  return sec;
}

function renderUsageSection(kind, name, d, days, countLabel) {
  const sec = el('section', `usage-section usage-${kind}`);
  sec.appendChild(el('h3', 'usage-h', name));

  // Stat tiles (headline numbers)
  const tiles = el('div', 'usage-tiles');
  const tile = (label, value, sub) => {
    const t = el('div', 'usage-tile');
    t.appendChild(el('div', 'tile-label', label));
    t.appendChild(el('div', 'tile-value', value));
    if (sub) t.appendChild(el('div', 'tile-sub', sub));
    tiles.appendChild(t);
  };
  tile('Today', fmtTokens(d.today.tokens), `tokens · ${d.today.count} ${countLabel}`);
  tile('7 days', fmtTokens(d.week.tokens), `tokens · ${d.week.count} ${countLabel}`);
  if (kind === 'claude') tile('Cost, 7 days', fmtUSD(d.cost7d || 0), 'API-equivalent');
  else tile('Output, 7 days', fmtTokens(d.week.output), 'tokens written');
  sec.appendChild(tiles);

  // Tokens per day (single series → no legend; the caption names it)
  sec.appendChild(el('div', 'usage-caption', 'Tokens per day'));
  sec.appendChild(renderDayBars(d.perDay, days, countLabel));

  // By model (both Claude and Antigravity)
  if (d.models && d.models.length) {
    sec.appendChild(el('div', 'usage-caption', 'By model, 7 days'));
    const max = d.models[0].tokens || 1;
    const list = el('div', 'usage-rows');
    for (const m of d.models) {
      const row = el('div', 'usage-row');
      row.appendChild(el('span', 'row-name', formatModelName(m.model) || m.model));
      const track = el('span', 'row-track');
      const fill = el('span', 'row-fill');
      fill.style.width = `${Math.max(2, (m.tokens / max) * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'row-num', fmtTokens(m.tokens)));
      row.title = `${m.model}\n${m.tokens.toLocaleString()} tokens · ${m.count} ${countLabel}`;
      list.appendChild(row);
    }
    sec.appendChild(list);
  }

  // Heaviest conversations
  if (d.sessions.length) {
    sec.appendChild(el('div', 'usage-caption', 'Most tokens, 7 days'));
    const list = el('div', 'usage-rows');
    for (const s of d.sessions) {
      const row = el('div', 'usage-row usage-session');
      const nameEl = el('span', 'row-name', s.title || 'Untitled session');
      nameEl.title = s.title || '';
      row.appendChild(nameEl);
      if (s.project) row.appendChild(el('span', 'row-project', s.project));
      row.appendChild(el('span', 'row-num', fmtTokens(s.tokens)));
      list.appendChild(row);
    }
    sec.appendChild(list);
  }
  return sec;
}

function renderDayBars(perDay, days, countLabel) {
  const wrap = el('div', 'usage-bars');
  const max = Math.max(1, ...perDay.map((b) => b.tokens));
  perDay.forEach((b, i) => {
    const col = el('div', 'bar-col');
    const plot = el('div', 'bar-plot');
    const bar = el('div', 'bar');
    bar.style.height = b.tokens ? `${Math.max(3, (b.tokens / max) * 100)}%` : '0';
    plot.appendChild(bar);
    // Selective direct label: today only
    if (i === perDay.length - 1 && b.tokens) col.appendChild(el('div', 'bar-value', fmtTokens(b.tokens)));
    else col.appendChild(el('div', 'bar-value', ''));
    col.appendChild(plot);
    col.appendChild(el('div', 'bar-label', days[i].label));

    // Hover tooltip (whole column is the hit target)
    col.addEventListener('mouseenter', () => {
      usageTooltip.innerHTML = '';
      usageTooltip.appendChild(el('div', 'tt-title', days[i].date));
      usageTooltip.appendChild(el('div', 'tt-main', `${b.tokens.toLocaleString()} tokens`));
      const rows = [
        ['Input', b.input], ['Cache reads', b.cacheRead], ['Output', b.output],
      ];
      for (const [k, v] of rows) {
        const r = el('div', 'tt-row');
        r.append(el('span', '', k), el('span', 'tt-num', fmtTokens(v)));
        usageTooltip.appendChild(r);
      }
      const r = el('div', 'tt-row');
      r.append(el('span', '', countLabel[0].toUpperCase() + countLabel.slice(1)), el('span', 'tt-num', String(b.count)));
      usageTooltip.appendChild(r);
      usageTooltip.style.display = '';
      const host = usageView.getBoundingClientRect();
      const c = col.getBoundingClientRect();
      const tw = usageTooltip.offsetWidth;
      let left = c.left - host.left + c.width / 2 - tw / 2;
      left = Math.max(4, Math.min(left, host.width - tw - 4));
      usageTooltip.style.left = `${left}px`;
      usageTooltip.style.top = `${c.top - host.top - usageTooltip.offsetHeight - 6}px`;
      col.classList.add('hover');
    });
    col.addEventListener('mouseleave', () => {
      usageTooltip.style.display = 'none';
      col.classList.remove('hover');
    });
    wrap.appendChild(col);
  });
  return wrap;
}

tbUsage?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isUsagePanelOpen()) closeUsagePanel();
  else openUsagePanel();
});
document.getElementById('btnUsageRefresh')?.addEventListener('click', (e) => {
  e.stopPropagation();
  loadUsage(true);
});
// Click outside / Esc closes it
document.addEventListener('click', (e) => {
  if (isUsagePanelOpen() && !usagePanel.contains(e.target) && e.target !== tbUsage) closeUsagePanel();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isUsagePanelOpen()) closeUsagePanel();
});

// ===========================================================================
// Silent "nudge" when a session finishes (main.js shakes the window)
// ===========================================================================
const justFinished = new Map(); // session id -> time it finished

if (window.electronAPI.onSessionNudge) {
  window.electronAPI.onSessionNudge(({ ids }) => {
    const now = Date.now();
    for (const id of ids || []) justFinished.set(id, now);

    // Glow the whole window briefly (restart the animation if already running)
    overlayCard.classList.remove('nudged');
    void overlayCard.offsetWidth;
    overlayCard.classList.add('nudged');
    setTimeout(() => overlayCard.classList.remove('nudged'), 1600);

    // Mini edge tab glows too
    const mini = document.getElementById('miniDock');
    if (mini) {
      mini.classList.remove('nudged');
      void mini.offsetWidth;
      mini.classList.add('nudged');
      setTimeout(() => mini.classList.remove('nudged'), 1600);
    }

    renderSessionCards(); // highlight the finished rows
    setTimeout(renderSessionCards, 5100); // and clear it afterwards
  });
}

// Initial load
setExpanded(true);
window.electronAPI.getInitialSessions().then((sessions) => {
  if (sessions && sessions.length > 0) {
    sessionsList = sessions;
    renderAll();
  }
});

// Settings → Restart app
document.getElementById('btnRestartApp')?.addEventListener('click', () => {
  // A reply sent from the HUD is streaming: restarting cuts it off
  const busy = typeof liveActivity !== 'undefined' && liveActivity.size > 0;
  if (busy && !confirm('A reply you sent from the HUD is still running. Restarting will stop it.\n\nRestart anyway?')) return;
  if (typeof closeSettingsPanel === 'function') closeSettingsPanel();
  window.electronAPI.restartApp?.();
});
