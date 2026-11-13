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
  if (closeVaultFocus()) vaultZoomFrom = null;
  else if (fromChat) zoomOutToRobot(); else vaultZoomFrom = null;
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
      contentBox.textContent = text;
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

function attachCodeCopyHandlers(container) {
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
  if (vaultFocus && !vaultFocusOpening) closeVaultFocus(false);
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

  resizeGrip.addEventListener('mousedown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.screenX;
    startY = e.screenY;

    const [w, h] = await window.electronAPI.getWindowSize();
    startWidth = w;
    startHeight = h;

    const onMouseMove = (moveEvent) => {
      if (!isResizing) return;
      const deltaX = moveEvent.screenX - startX;
      const deltaY = moveEvent.screenY - startY;
      const newW = Math.max(360, Math.min(1400, startWidth + deltaX));
      const newH = Math.max(240, Math.min(1200, startHeight + deltaY)); // never collapses

      window.electronAPI.setWindowSize(newW, newH);
    };

    const onMouseUp = () => {
      isResizing = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
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
  let uiStyle = window.electronAPI.settings?.uiStyle === 'classic' ? 'classic' : 'shelter';
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
    const shelter = uiStyle === 'shelter';
    placeChatPictures(shelter);
    document.body.classList.toggle('style-shelter', shelter);
    document.body.classList.toggle('theme-aero', !shelter && theme !== 'dark');
    document.body.classList.toggle('theme-vista', !shelter && theme === 'vista');
    document.body.classList.toggle('theme-xp', !shelter && theme === 'xp');
    const v = document.getElementById('setThemeVal');
    if (v) v.textContent = LABELS[theme] || 'Aero';
    window.electronAPI.notesTheme?.(shelter ? 'dark' : theme); // the pinned-notes panel follows
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
    const styleBtns = [['shelter', 'Shelter'], ['classic', 'Classic (Windows)']].map(([key, label]) => {
      const b = document.createElement('button');
      b.className = 'theme-pill';
      b.textContent = label;
      b.addEventListener('click', () => {
        uiStyle = key;
        window.electronAPI.storeSet('uiStyle', uiStyle);
        apply(theme);
        styleBtns.forEach((x, i) => x.classList.toggle('active', ['shelter', 'classic'][i] === uiStyle));
      });
      stylePills.appendChild(b);
      return b;
    });
    styleBtns.forEach((x, i) => x.classList.toggle('active', ['shelter', 'classic'][i] === uiStyle));
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

  const appearance = makeSection('Appearance', [
    settingsPanel.querySelector('.set-style-row'), settingsPanel.querySelector('.style-pills'), byId('btnTheme'), themePills,
  ]);
  const behavior = makeSection('Behavior', [byId('btnSound'), byId('btnNudge'), byId('btnPin'), byId('btnNotify'), byId('btnShowAg')]);
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

  sortedGroups.forEach(group => {
    const isCollapsed = collapsedGroups.has(group.key);
    const groupEl = document.createElement('div');
    groupEl.className = `workspace-group ${isCollapsed ? 'collapsed' : ''}`;

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

    const vaultRoom = buildWorkspaceVaultRoom(ordered, { name: group.name, runningN, attnN, total: group.sessions.length });
    groupEl.appendChild(header);
    if (vaultRoom) groupEl.appendChild(vaultRoom);
    groupEl.appendChild(body);
    sessionsContainer.appendChild(groupEl);
  });
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
  document.body.classList.toggle('list-grid', listViewMode === 'grid');
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
function saveCollapsedGroups() {
  window.electronAPI.storeSet('collapsedGroups', [...collapsedGroups]);
}

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

const IDLE_POSES = ['stand', 'stand', 'read', 'type', 'think', 'search', 'done'];
const IDLE_EMOTES = {
  stand: ['☕', '🎵', ''],
  read: ['📖', ''],
  type: ['⌨', ''],
  think: ['💡', ''],
  search: ['🔍', ''],
  done: ['👋', '✨'],
  walk: [''],
};
// Walking pace in screen pixels, so a wide room is not crossed faster than a narrow one.
// 26 px/s matches the leg cycle in features.css (0.8s, ±24°): about 10px of ground per
// step, so the feet stay planted instead of sliding.
const WALK_PX_PER_SEC = 26;
const TURN_MS = 0; // turning round is instant (no pause before setting off)
const MIN_STAY_MS = 3000; // once at a piece, work there at least this long before heading elsewhere
function vaultRoomWidth() {
  // rooms span the list's width; on the very first draw there is no room to measure yet
  return document.querySelector('#listView .vault-room')?.clientWidth ||
    Math.max(0, (document.getElementById('sessionsContainer')?.clientWidth || 0) - 2) || 420;
}
function walkSecs(distPct) {
  return Math.max(0.7, (Math.abs(distPct) / 100) * vaultRoomWidth() / WALK_PX_PER_SEC);
}
// `left` moves linearly, matching the step cycle
function walkTransition(secs, delayMs = 0) {
  return `left ${secs.toFixed(2)}s linear ${delayMs}ms`;
}
const vaultDwellerAI = new Map(); // sessionId -> { x, face, pose, emote, dur, stopAt, nextAt }

function getIdleDwellerState(session, idx, totalCount) {
  const now = Date.now();
  let st = vaultDwellerAI.get(session.id);
  if (!st) {
    const h = sessionHash(session);
    const pose = IDLE_POSES[(h + idx) % IDLE_POSES.length];
    const baseX = totalCount === 1 ? 48 : Math.round(16 + (idx / Math.max(1, totalCount - 1)) * 68);
    st = {
      x: Math.max(12, Math.min(88, baseX + ((h % 13) - 6))),
      face: (h % 2) ? 1 : -1,
      pose,
      emote: '',
      dur: 0,
      stopAt: 0,
      nextAt: now + 1200 + (h % 5) * 900,
    };
    vaultDwellerAI.set(session.id, st);
  }
  return st;
}

// occupied: % positions other robots are standing at (working spots) — idle robots
// don't pick a spot on top of someone
function stepIdleDweller(st, occupied = []) {
  const now = Date.now();
  if (st.pose === 'walk' && now >= st.stopAt) {
    // Arrived at destination: stop moving legs immediately!
    st.pose = 'stand';
    st.dur = 0;
    st.stopAt = 0;
    st.nextAt = now + 900 + Math.random() * 1400;
    return;
  }
  const roll = Math.random();
  if (roll < 0.45) {
    let targetX = st.x;
    for (let tries = 0; tries < 8; tries++) {
      const t = Math.round(12 + Math.random() * 76);
      if (occupied.every((o) => Math.abs(o - t) >= 9)) { targetX = t; break; }
    }
    if (Math.abs(targetX - st.x) < 2) { st.nextAt = now + 1500; return; } // nowhere free: wait
    const dist = Math.abs(targetX - st.x);
    const dur = +walkSecs(dist).toFixed(2);
    st.face = targetX >= st.x ? 1 : -1;
    st.fromX = st.x;            // remembered so a redraw mid-walk puts it part-way, not at the end
    st.walkT0 = now + TURN_MS;
    st.x = targetX;
    st.pose = 'walk';
    st.dur = dur;
    st.turnMs = TURN_MS;
    st.stopAt = now + TURN_MS + dur * 1000;
    st.emote = '';
    st.nextAt = st.stopAt;
  } else {
    const acts = ['stand', 'read', 'type', 'think', 'search', 'done'];
    st.pose = acts[Math.floor(Math.random() * acts.length)];
    st.face = Math.random() < 0.5 ? 1 : -1;
    st.dur = 0;
    st.turnMs = 0;
    st.stopAt = 0;
    const pool = IDLE_EMOTES[st.pose] || [''];
    st.emote = Math.random() < 0.45 ? pool[Math.floor(Math.random() * pool.length)] : '';
    st.nextAt = now + 3500 + Math.random() * 3500;
  }
}

// ---- Working robots go to the furniture for their task -------------------------
// Each workspace keeps a stable set of furniture (seeded, not tied to the "lead"
// robot). A working robot walks from where it is to the piece for its current step
// and uses it there. If the room has no such piece, it appears with a smoke puff;
// pieces that appeared that way poof away after a minute unused.
const TASK_FURNITURE = { hammer: 'promptTerm', type: 'diffDesk', read: 'ctxTank', search: 'vectorPods', web: 'mcpDock', think: 'whiteboard', run: 'gpuRack' };
const TASK_POSE_AT = { run: 'type' }; // "working" with no specific tool: operating the GPU rack
// How far from a piece's centre a robot stands to use it (px): close enough that its
// hands reach the keyboard / screen / panel, overlapping the piece's edge a little
const STANCE_PX = { diffDesk: 20, promptTerm: 24, gpuRack: 22, ctxTank: 20, vectorPods: 24, mcpDock: 22, whiteboard: 26, forgeCore: 26, rechargePod: 26 };
const FURN_SLOTS = [12, 25, 38, 51, 64, 77, 88];
const vaultRoomFurniture = new Map(); // room key -> [{ kind, x, spawned, needsPuff, lastUsed }]
const vaultWorkerAI = new Map();      // session id -> { x, tx, t0, dur, kind, side }

function roomFurnitureState(key, seed) {
  let list = vaultRoomFurniture.get(key);
  if (list) return list;
  const pool = [...ROOM_FURNITURE_POOLS.lounge];
  let s = Math.abs(seed || 1);
  for (let i = pool.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const slots = [12, 38, 64, 88].filter((_, i) => !(i === 2 && (s % 4) === 0));
  list = slots.map((x, i) => ({ kind: pool[i], x, spawned: false, needsPuff: false, lastUsed: 0 }));
  vaultRoomFurniture.set(key, list);
  return list;
}

// The piece for `kind` in this room, spawning it into a free spot if needed
function furnitureFor(list, kind, busy) {
  let f = list.find((p) => p.kind === kind);
  if (f) return f;
  const free = FURN_SLOTS.find((x) => list.every((p) => Math.abs(p.x - x) >= 12));
  if (free !== undefined) {
    f = { kind, x: free, spawned: true, needsPuff: true, lastUsed: Date.now() };
    list.push(f);
    return f;
  }
  // room full: swap out a piece nobody is using
  const spare = list.find((p) => !busy.has(p));
  if (!spare) return list[0];
  Object.assign(spare, { kind, spawned: true, needsPuff: true, lastUsed: Date.now() });
  return spare;
}

// Where a robot is right now (it may be part-way through a walk)
function workerPos(st, now = Date.now()) {
  if (!st.dur) return st.tx;
  const k = Math.max(0, Math.min(1, (now - st.t0) / (st.dur * 1000))); // t0 may be ahead (still turning)
  return st.x + (st.tx - st.x) * k;
}

function furnitureSvg(p) {
  return `<svg class="vault-furn${p.needsPuff ? ' furn-spawn' : ''}${p.inUse ? ' in-use' : ''}" data-kind="${p.kind}" style="left:${p.x}%" viewBox="0 0 64 56">${AI_FURNITURE[p.kind]}</svg>`;
}

// After the room is on screen: puff for pieces that just appeared or left
function puffRoomFurniture(room, events) {
  if (!events.length) return;
  requestAnimationFrame(() => {
    const wall = room.querySelector('.vault-wall')?.getBoundingClientRect();
    if (!wall || !wall.width || typeof smokePuff !== 'function') return;
    for (const x of events) smokePuff(wall.left + wall.width * x / 100, wall.bottom - 26, 44);
  });
}

setInterval(() => {
  if (!document.body.classList.contains('list-grid') || document.body.classList.contains('list-compact')) return;
  const now = Date.now();
  const drawBot = (el, s, pose) => {
    const bot = el.querySelector('.vault-bot');
    if (bot) bot.innerHTML = window.buildRunnerSvg(robotHueFor(s), window.robotOutfitFor?.(s) || null, pose);
  };
  const setPoseClass = (el, pose) => {
    el.dataset.pose = pose;
    for (const c of [...el.classList]) if (c.startsWith('pose-')) el.classList.remove(c);
    el.classList.add(`pose-${pose}`);
  };
  // Working robot reaches its furniture: stop, turn to face it…
  document.querySelectorAll('.vault-walker[data-working="1"][data-arrive]').forEach((el) => {
    if (now < Number(el.dataset.arrive)) return;
    el.removeAttribute('data-arrive');
    const s = sessionsList.find((x) => x.id === el.dataset.sid);
    if (!s || !el.dataset.taskPose) return;
    el.classList.remove('is-walking');
    setPoseClass(el, 'stand');
    drawBot(el, s, 'stand');
    const bot = el.querySelector('.vault-bot');
    if (bot) bot.style.transform = `scaleX(${el.dataset.face || 1})`;
    el.dataset.engage = String(now + 320);
  });
  // …then reach in and start the task
  document.querySelectorAll('.vault-walker[data-working="1"][data-engage]').forEach((el) => {
    if (now < Number(el.dataset.engage)) return;
    el.removeAttribute('data-engage');
    const s = sessionsList.find((x) => x.id === el.dataset.sid);
    const pose = el.dataset.taskPose;
    if (!s || !pose) return;
    setPoseClass(el, pose);
    drawBot(el, s, pose);
    el.classList.add('engage');
    el.closest('.vault-room')?.querySelector(`.vault-furn[data-kind="${el.dataset.kind}"]`)?.classList.add('in-use');
    setTimeout(() => el.classList.remove('engage'), 600);
    if (pose === 'think' && !el.querySelector('.act-bubble')) el.insertAdjacentHTML('beforeend', '<span class="act-bubble"><i></i><i></i><i></i></span>');
  });
  document.querySelectorAll('.vault-walker[data-idle="1"]').forEach((el) => {
    const sid = el.dataset.sid;
    const s = sessionsList.find((x) => x.id === sid);
    if (!s) return;
    const st = vaultDwellerAI.get(sid);
    if (!st || now < st.nextAt || vaultFocus?.id === sid) return;
    // spots where robots are working in this room
    const occupied = [...(el.closest('.vault-room')?.querySelectorAll('.vault-walker[data-working="1"]') || [])]
      .map((w) => parseFloat(w.style.left)).filter((v) => !Number.isNaN(v));
    stepIdleDweller(st, occupied);
    const prevPose = el.dataset.pose;
    setPoseClass(el, st.pose);
    el.classList.toggle('is-walking', st.pose === 'walk');
    el.style.transition = st.dur ? walkTransition(st.dur, st.turnMs || 0) : '';
    el.style.left = `${st.x}%`;
    const bot = el.querySelector('.vault-bot');
    if (bot) {
      bot.style.transform = `scaleX(${st.face})`;
      if (prevPose !== st.pose && typeof window.buildRunnerSvg === 'function') {
        const hue = typeof robotHueFor === 'function' ? robotHueFor(s) : 0;
        const outfit = typeof window.robotOutfitFor === 'function' ? window.robotOutfitFor(s) : null;
        bot.innerHTML = window.buildRunnerSvg(hue, outfit, st.pose);
      }
    }
    let bub = el.querySelector('.act-bubble');
    if (st.pose === 'think') {
      if (!bub) { bub = document.createElement('span'); bub.className = 'act-bubble'; bub.innerHTML = '<i></i><i></i><i></i>'; el.appendChild(bub); }
    } else if (bub) {
      bub.remove();
    }
    let em = el.querySelector('.vault-emote');
    if (st.emote) {
      if (!em) { em = document.createElement('span'); em.className = 'vault-emote'; el.appendChild(em); }
      em.textContent = st.emote;
    } else if (em) {
      em.remove();
    }
  });
}, 300);

// Vault view → chat as one zoom: the room scales up toward the robot you clicked
// and dissolves while the chat grows out of that spot. Back plays it in reverse
// (see showListView). Falls back to a plain switch with reduced motion.
var vaultZoomBusy = false; // var: showListView can run before this line during startup
var vaultZoomFrom = null; // session id whose robot opened the chat

// ---- Focus mode (HUD at least 400px wide): the rooms stay, zoomed so the robot sits
// big in a strip on the left; the chat slides in as a panel on the right with a
// pointer at the robot. Other robots in the strip can be clicked to switch chats.
var vaultFocus = null;          // { id, t: {x, y, s}, settleAt } while a chat is open beside its robot
var vaultFocusOpening = false;  // showDetailView called by focus mode itself
const FOCUS_SCALE = 2.1;
function focusRobotEl(id) {
  return listView.querySelector(`.vault-walker[data-sid="${CSS.escape(id)}"] .vault-bot`);
}
// Move/scale the list so the focused robot lands in the middle of the left strip
function alignFocus(animate) {
  if (!vaultFocus) return;
  const bot = focusRobotEl(vaultFocus.id);
  if (!bot) return;
  const pb = popupBody.getBoundingClientRect();
  const strip = Math.max(110, Math.min(170, pb.width * 0.3));
  const tx = pb.left + strip / 2, ty = pb.top + Math.min(pb.height * 0.42, 190);
  const m = new DOMMatrixReadOnly(getComputedStyle(listView).transform); // as drawn right now (may be mid-slide)
  const cur = { x: m.e, y: m.f, s: m.a || 1 };
  const lv = listView.getBoundingClientRect();   // includes the current transform (origin 0 0)
  const r = bot.getBoundingClientRect();
  const px = (r.left + r.width / 2 - lv.left) / cur.s, py = (r.top + r.height / 2 - lv.top) / cur.s;
  const x0 = lv.left - cur.x, y0 = lv.top - cur.y;  // untransformed top-left
  const t = { x: tx - x0 - FOCUS_SCALE * px, y: ty - y0 - FOCUS_SCALE * py, s: FOCUS_SCALE };
  vaultFocus.t = t;
  listView.style.transition = animate ? 'transform .5s cubic-bezier(.3,.7,.2,1)' : 'none';
  listView.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.s})`;
  if (animate) vaultFocus.settleAt = Date.now() + 520;
  popupBody.style.setProperty('--focus-strip', `${strip}px`);
  popupBody.style.setProperty('--focus-tail', `${ty - pb.top}px`);
}
function openVaultFocus(session) {
  if (!document.body.classList.contains('list-grid') || popupBody.getBoundingClientRect().width < 400) return false;
  if (!focusRobotEl(session.id)) return false; // chips in the drawer: no robot to point at
  const switching = !!vaultFocus;
  vaultFocus = { id: session.id };
  vaultFocusOpening = true;
  try { showDetailView(session); } finally { vaultFocusOpening = false; }
  document.body.classList.add('vault-focus');
  listView.querySelectorAll('.vault-walker.is-focus').forEach((w) => w.classList.remove('is-focus'));
  focusRobotEl(session.id).closest('.vault-walker').classList.add('is-focus');
  alignFocus(!reducedMotion());
  if (reducedMotion()) return true;
  detailView.animate(switching
    ? [{ opacity: 0.35 }, { opacity: 1 }]
    : [{ transform: 'translateX(55%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
  { duration: switching ? 220 : 440, delay: switching ? 0 : 90, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  return true;
}
// Leave focus mode. animate=false when another part of the HUD takes over the view.
function closeVaultFocus(animate = true) {
  if (!vaultFocus) return false;
  vaultFocus = null;
  document.body.classList.remove('vault-focus');
  listView.querySelectorAll('.vault-walker.is-focus').forEach((w) => w.classList.remove('is-focus'));
  listView.style.transition = animate && !reducedMotion() ? 'transform .42s cubic-bezier(.3,.7,.2,1)' : 'none';
  listView.style.transform = '';
  setTimeout(() => { if (!vaultFocus) listView.style.transition = ''; }, 450);
  return true;
}
// Clicking the rooms beside the chat panel closes the chat (zooms back out).
// Robots and drawer chips still switch chats. Capture phase, so the click doesn't
// also collapse a workspace or open something underneath.
listView.addEventListener('click', (e) => {
  if (!vaultFocus || e.target.closest('.vault-walker, .vault-chip')) return;
  e.preventDefault();
  e.stopPropagation();
  showListView();
}, true);

// The list re-renders on every update: keep the robot under the pointer
const renderCardsBeforeFocus = renderSessionCards;
renderSessionCards = function (...args) {
  const out = renderCardsBeforeFocus.apply(this, args);
  if (vaultFocus) {
    const wait = Math.max(0, (vaultFocus.settleAt || 0) - Date.now());
    setTimeout(() => {
      if (!vaultFocus) return;
      focusRobotEl(vaultFocus.id)?.closest('.vault-walker').classList.add('is-focus');
      alignFocus(false);
    }, wait);
  }
  return out;
};

function zoomIntoChat(session, fromEl) {
  if (vaultZoomBusy) return;
  // already chatting with this robot (focus mode): clicking it opens dress-up
  if (vaultFocus?.id === session.id && fromEl?.classList.contains('vault-walker') && window.openDressUp) {
    window.openDressUp(fromEl);
    return;
  }
  if (openVaultFocus(session)) return;
  const room = fromEl?.closest('.vault-room') || fromEl?.closest('.vault-drawer')?.previousElementSibling || null;
  const r = fromEl?.getBoundingClientRect();
  if (!room || !r || !r.width || reducedMotion()) { vaultZoomFrom = session.id; showDetailView(session); return; }
  vaultZoomBusy = true;
  vaultZoomFrom = session.id;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

  // a frozen copy of the room on top, so it can keep zooming after the view switches
  const rr = room.getBoundingClientRect();
  const ghost = room.cloneNode(true);
  ghost.classList.add('vault-zoom-ghost');
  Object.assign(ghost.style, { left: rr.left + 'px', top: rr.top + 'px', width: rr.width + 'px', height: rr.height + 'px' });
  ghost.style.transformOrigin = `${cx - rr.left}px ${cy - rr.top}px`;
  ghost.querySelector(`.vault-walker[data-sid="${CSS.escape(session.id)}"]`)?.classList.add('zoom-target');
  document.body.appendChild(ghost);

  showDetailView(session);

  const dv = detailView.getBoundingClientRect();
  const x = cx - dv.left, y = cy - dv.top;
  const R = Math.hypot(Math.max(x, dv.width - x), Math.max(y, dv.height - y));
  const reveal = detailView.animate([
    { clipPath: `circle(14px at ${x}px ${y}px)`, opacity: 0.6 },
    { clipPath: `circle(${R}px at ${x}px ${y}px)`, opacity: 1 },
  ], { duration: 460, delay: 70, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' });
  ghost.animate([
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(1.9)', opacity: 1, offset: 0.45 },
    { transform: 'scale(3.2)', opacity: 0 },
  ], { duration: 480, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
  const finish = () => { ghost.remove(); vaultZoomBusy = false; };
  reveal.onfinish = finish;
  reveal.oncancel = finish;
  setTimeout(finish, 900); // never leave the overlay behind
}

// Back from a chat that was opened from a robot: the list zooms out from that robot
function zoomOutToRobot() {
  const id = vaultZoomFrom;
  vaultZoomFrom = null;
  if (!id || reducedMotion() || !document.body.classList.contains('list-grid')) return;
  const bot = listView.querySelector(`.vault-walker[data-sid="${CSS.escape(id)}"]`) ||
    listView.querySelector(`.vault-chip[data-sid="${CSS.escape(id)}"]`);
  const r = bot?.getBoundingClientRect();
  const lv = listView.getBoundingClientRect();
  if (!r || !r.width || !lv.width) return;
  listView.style.transformOrigin = `${r.left + r.width / 2 - lv.left}px ${r.top + r.height / 2 - lv.top}px`;
  listView.animate([
    { transform: 'scale(2.6)', opacity: 0 },
    { transform: 'scale(1.25)', opacity: 1, offset: 0.55 },
    { transform: 'scale(1)', opacity: 1 },
  ], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' }).onfinish = () => { listView.style.transformOrigin = ''; };
  bot.classList.add('zoom-landed');
  setTimeout(() => bot.classList.remove('zoom-landed'), 900);
}

function buildWorkspaceVaultRoom(orderedSessions, groupMeta = {}) {
  if (typeof window.buildRunnerSvg !== 'function' || !orderedSessions.length) return null;
  const maxDwellers = 6;
  const dwellers = orderedSessions.slice(0, maxDwellers);
  const overflow = orderedSessions.length - dwellers.length;
  const metaOf = (s) => {
    const isAttn = s.unread || s.state === 'attention';
    const state = isAttn ? 'attention' : (s.status === 'running' ? 'running' : 'idle');
    return { s, state, ...sessionVaultMeta(s, state) };
  };
  const items = dwellers.map(metaOf);
  const roomSeed = sessionHash({ id: groupMeta.name || orderedSessions[0].id });
  const roomKey = groupMeta.name || workspaceKey(orderedSessions[0]);
  const furn = roomFurnitureState(roomKey, roomSeed);
  const now = Date.now();

  // Working robots → the piece for their task, one spot per side of it
  const roomW = vaultRoomWidth();
  const busy = new Set();
  const spotsTaken = new Map(); // furniture -> robots placed there
  const work = new Map();       // session id -> { tx, face, pose }
  for (const d of items) {
    if (d.state !== 'running') continue;
    let kind = TASK_FURNITURE[d.pose] || 'gpuRack';
    let taskPose = TASK_POSE_AT[d.pose] || d.pose;
    // committed: keep heading for / working at the current piece until it has arrived
    // and stayed MIN_STAY_MS, so quick steps don't make it U-turn on the way
    const cur = vaultWorkerAI.get(d.s.id);
    if (cur?.kind && cur.kind !== kind && now < (cur.commitUntil || 0)) { kind = cur.kind; taskPose = cur.taskPose; }
    const piece = furnitureFor(furn, kind, busy);
    busy.add(piece);
    piece.lastUsed = now;
    const n = spotsTaken.get(piece) || 0;
    spotsTaken.set(piece, n + 1);
    const side = n % 2 === 0 ? -1 : 1;                 // left of it first, then right
    // stand close enough to reach it (px from its centre), next robots further out
    const px = (STANCE_PX[piece.kind] || 24) + Math.floor(n / 2) * 20;
    const tx = Math.max(4, Math.min(96, piece.x + side * (px / roomW) * 100));
    work.set(d.s.id, { tx, face: -side, pose: taskPose, kind, piece });
  }
  // pieces that appeared for a task poof away after a minute unused
  const puffs = [];
  for (let i = furn.length - 1; i >= 0; i--) {
    const p = furn[i];
    if (p.spawned && !busy.has(p) && now - p.lastUsed > 60000) { puffs.push(p.x); furn.splice(i, 1); }
  }
  // a piece is "in use" once a robot has arrived at it (its screens, LEDs… come alive)
  for (const p of furn) p.inUse = false;
  for (const [sid, job] of work) {
    const st = vaultWorkerAI.get(sid);
    if (st && Math.abs(st.tx - job.tx) < 0.3 && now >= st.t0 + st.dur * 1000) job.piece.inUse = true;
  }
  const furnitureHtml = furn.map(furnitureSvg).join('');
  for (const p of furn) if (p.needsPuff) { puffs.push(p.x); p.needsPuff = false; }

  // One fixed room type (label + colour) per workspace, so the room doesn't flip
  // colour whenever the "lead" robot changes task. Needs-you = an alert glow on top.
  const STABLE_ROOMS = ['lab', 'forge', 'library', 'recon', 'comms', 'command'];
  const roomType = STABLE_ROOMS[roomSeed % STABLE_ROOMS.length];
  const anyAttn = items.some((d) => d.state === 'attention');
  const room = document.createElement('div');
  room.className = `vault-room vault-stage room-${roomType}${anyAttn ? ' room-alert-on' : ''}`;
  room.innerHTML =
    '<span class="vault-ceiling"></span>' +
    `<span class="vault-wall">${furnitureHtml}</span>` +
    '<span class="vault-plaque"><span class="vault-ws-name"></span><span class="vault-ws-tag"></span></span>' +
    '<span class="vault-shaft left"></span>' +
    '<span class="vault-shaft right"></span>' +
    '<span class="vault-floor"></span>';
  room.querySelector('.vault-ws-name').textContent = groupMeta.name || orderedSessions[0].project || 'Workspace';
  const total = groupMeta.total ?? orderedSessions.length;
  const runningN = groupMeta.runningN ?? items.filter((d) => d.state === 'running').length;
  room.querySelector('.vault-ws-tag').textContent = `${VAULT_ROOMS[roomType].label} · ${runningN}/${total}`;

  items.forEach((d, idx) => {
    const hue = typeof robotHueFor === 'function' ? robotHueFor(d.s) : 0;
    const outfit = typeof window.robotOutfitFor === 'function' ? window.robotOutfitFor(d.s) : null;
    const hash = sessionHash(d.s);
    const isIdle = d.state === 'idle';
    const prevWork = vaultWorkerAI.get(d.s.id);
    const job = work.get(d.s.id);
    // a robot that just stopped working carries on from where it is
    if (!job && prevWork) {
      const at = workerPos(prevWork, now);
      if (isIdle) {
        const st = getIdleDwellerState(d.s, idx, items.length);
        Object.assign(st, { x: at, pose: 'stand', dur: 0, stopAt: 0, nextAt: now + 1500 });
      }
      vaultWorkerAI.set(d.s.id, { x: at, tx: at, t0: now, dur: 0, parked: true });
      if (isIdle) vaultWorkerAI.delete(d.s.id);
    }
    const ai = isIdle ? getIdleDwellerState(d.s, idx, items.length) : null;

    let pose = ai ? ai.pose : d.pose;
    let face = ai ? ai.face : ((hash % 2) ? 1 : -1);
    let slotPct = ai ? ai.x : (items.length === 1 ? 50 : Math.round(16 + (idx / (items.length - 1)) * 68));
    let walkTo = null; // { tx, secs } when the robot is still on its way
    if (ai && ai.pose === 'walk') {
      // idle robot mid-walk: draw it where it is now and let it carry on
      if (now >= ai.stopAt) {
        pose = 'stand';                                  // arrived between ticks
      } else {
        const t = Math.max(0, now - (ai.walkT0 || now));
        const k = ai.dur ? Math.min(1, t / (ai.dur * 1000)) : 1;
        const from = ai.fromX ?? ai.x;
        slotPct = from + (ai.x - from) * k;
        const delay = Math.max(0, (ai.walkT0 || now) - now);
        walkTo = { tx: ai.x, secs: (ai.stopAt - now - delay) / 1000, delay, turnTo: null };
      }
    }
    if (job) {
      let st = vaultWorkerAI.get(d.s.id);
      const from = st ? workerPos(st, now) : (vaultDwellerAI.get(d.s.id)?.x ?? slotPct);
      if (vaultFocus?.id === d.s.id) {
        st = { x: from, tx: from, t0: now, dur: 0 };     // talking to you: stay put
      } else if (!st || Math.abs(st.tx - job.tx) > 0.3 || st.parked) {
        const far = Math.abs(job.tx - from) >= 0.5;
        const prevFace = st?.face ?? vaultDwellerAI.get(d.s.id)?.face ?? 1;
        // turn round first (TURN_MS), then walk
        st = { x: from, tx: job.tx, t0: now + (far ? TURN_MS : 0), dur: far ? walkSecs(job.tx - from) : 0,
          face: job.tx >= from ? 1 : -1, prevFace, fresh: far };
        st.commitUntil = st.t0 + st.dur * 1000 + MIN_STAY_MS;
      }
      st.kind = job.kind;
      st.taskPose = job.pose;
      vaultWorkerAI.set(d.s.id, st);
      const at = workerPos(st, now);
      const left = st.dur ? st.t0 + st.dur * 1000 - now : 0;
      slotPct = at;
      if (left > 50) {
        pose = 'walk';
        face = st.fresh ? st.prevFace : st.face;          // a new walk starts facing the old way…
        const delay = Math.max(0, st.t0 - now);
        walkTo = { tx: st.tx, secs: Math.min(left, st.dur * 1000) / 1000, delay, turnTo: st.fresh ? st.face : null };
        st.fresh = false;                                 // …and turns once (below)
      } else {
        pose = job.pose;
        face = job.face;
      }
    } else if (d.state === 'attention' && vaultWorkerAI.has(d.s.id)) {
      slotPct = vaultWorkerAI.get(d.s.id).tx;  // needs you: stays at its last spot
    }

    const dweller = document.createElement('div');
    dweller.className = `vault-walker pose-${pose}${d.state === 'attention' ? ' is-attn' : ''}`;
    dweller.dataset.sid = d.s.id;
    if (vaultFocus?.id === d.s.id) dweller.classList.add('is-focus');
    dweller.dataset.pose = pose;
    if (isIdle) dweller.dataset.idle = '1';
    if (job) {
      dweller.dataset.working = '1';
      dweller.dataset.taskPose = job.pose;
      dweller.dataset.kind = job.kind;
      dweller.dataset.face = String(job.face);
    }
    dweller.style.left = `${slotPct}%`;
    if (walkTo) {
      dweller.dataset.arrive = String(now + walkTo.delay + walkTo.secs * 1000);
      dweller.classList.add('is-walking');                // draws on top of anyone it passes
      // once the room is on screen: turn round, then walk
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (walkTo.turnTo != null) {
          const b = dweller.querySelector('.vault-bot');
          if (b) b.style.transform = `scaleX(${walkTo.turnTo})`;
        }
        dweller.style.transition = walkTransition(walkTo.secs, walkTo.delay);
        dweller.style.left = `${walkTo.tx}%`;
      }));
    }
    const title = d.s.sessionTitle || d.s.aiTitle || 'Untitled session';
    const actLabel = d.state === 'running' ? friendlyStatus(d.s, 'running') : (d.state === 'attention' ? 'Needs input' : 'Idle');
    const shortName = agentLabel(d.s.source, d.s.id);
    const said = (d.s.detail || '').replace(/\s+/g, ' ').trim();
    dweller.title = `${shortName} — ${title}\n${actLabel}${said ? `\n\n${said.slice(0, 160)}${said.length > 160 ? '…' : ''}` : ''}`;
    // a button: Tab to it, Enter/Space opens the chat, right-click = the row menu (features.js)
    dweller.tabIndex = 0;
    dweller.setAttribute('role', 'button');
    dweller.setAttribute('aria-label', `${shortName}: ${title}. ${actLabel}`);
    dweller.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoomIntoChat(d.s, dweller); }
    });
    dweller.innerHTML =
      `<span class="vault-bot" style="transform:scaleX(${face})">${window.buildRunnerSvg(hue, outfit, pose)}</span>` +
      (pose === 'think' ? '<span class="act-bubble"><i></i><i></i><i></i></span>' : '') +
      (ai && ai.emote ? `<span class="vault-emote">${ai.emote}</span>` : '') +
      (d.state === 'attention' ? '<span class="vault-ping">!</span>' : '') +
      '<span class="vault-shadow"></span><span class="vault-name"></span>';
    dweller.querySelector('.vault-name').textContent = shortName;
    dweller.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomIntoChat(d.s, dweller);
    });
    room.appendChild(dweller);
  });

  puffRoomFurniture(room, puffs);
  if (overflow <= 0) return room;

  // Chats that don't fit on the floor: a drawer of small chips under the room,
  // so every chat can still be opened (click / Enter) and right-clicked.
  const out = document.createDocumentFragment();
  const drawer = document.createElement('div');
  drawer.className = 'vault-drawer';
  const lbl = document.createElement('span');
  lbl.className = 'vault-drawer-label';
  lbl.textContent = `+${overflow} more:`;
  drawer.appendChild(lbl);
  for (const s of orderedSessions.slice(maxDwellers)) {
    const isAttn = s.unread || s.state === 'attention';
    const chip = document.createElement('button');
    chip.className = `vault-chip${isAttn ? ' is-attn' : s.status === 'running' ? ' is-running' : ''}`;
    chip.dataset.sid = s.id;
    const hue = typeof robotHueFor === 'function' ? robotHueFor(s) : 0;
    const dot = document.createElement('i');
    dot.style.background = shiftHexHue('#62b6d8', hue);
    const name = document.createElement('span');
    const title = s.sessionTitle || s.aiTitle || agentLabel(s.source, s.id);
    name.textContent = title;
    chip.title = `${agentLabel(s.source, s.id)} — ${title}\n${isAttn ? 'Needs input' : s.status === 'running' ? friendlyStatus(s, 'running') : 'Idle'}`;
    chip.append(dot, name);
    chip.addEventListener('click', (e) => { e.stopPropagation(); zoomIntoChat(s, chip); });
    drawer.appendChild(chip);
  }
  out.append(room, drawer);
  return out;
}

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
  const pose = activityPose(act);
  const look = `${hue}|${outfit ? JSON.stringify(outfit) : ''}|${pose}`;
  if (bot.dataset.look !== look && typeof window.buildRunnerSvg === 'function') {
    bot.dataset.look = look;
    bot.innerHTML = window.buildRunnerSvg(hue, outfit, pose) +
      (pose === 'think' ? '<span class="act-bubble"><i></i><i></i><i></i></span>' : '');
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
  }
  const n = tr.steps.length;
  pill.style.display = n ? '' : 'none';
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
  trail.textContent = '';
  box.style.display = n && activityTrailOpen ? '' : 'none';
  if (n && activityTrailOpen) {
    for (const st of [...tr.steps].reverse()) {
      const r = document.createElement('div');
      r.className = 'act-step';
      const ic = document.createElement('span'); ic.className = 'act-step-ico'; ic.textContent = st.icon;
      const v = document.createElement('span'); v.className = 'act-step-verb'; v.textContent = st.verb;
      const t = document.createElement('span'); t.className = 'act-step-target'; t.textContent = st.target || '';
      const when = document.createElement('span'); when.className = 'act-step-time'; when.textContent = fmtElapsed(Date.now() - st.at) + ' ago';
      r.title = st.target ? `${st.verb} ${st.target}` : st.verb;
      r.append(ic, v, t, when);
      trail.appendChild(r);
    }
  }
}

// Team stage: helper agents work next to the lead robot, each acting out its own step.
// New helpers pop out of a smoke puff; finished ones wave a ✓, then poof away.
const TEAM_MAX = 4;
const TEAM_HUE = { Explore: -40, Plan: 80, 'general-purpose': 190, claude: 140 };
function teamHue(type) {
  if (type in TEAM_HUE) return TEAM_HUE[type];
  let h = 0;
  for (const ch of String(type)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 12) * 30;
}
function renderActivityTeam(row, s) {
  const subs = Array.isArray(s.subagents) ? s.subagents : [];
  let team = row.querySelector('.act-team');
  if (!subs.length) {
    if (team) {
      for (const m of team.querySelectorAll('.team-mate')) teamPoof(m);
      team.remove();
    }
    return;
  }
  if (!team) {
    team = document.createElement('div');
    team.className = 'act-team';
    team.innerHTML = '<span class="team-line"><i></i></span><div class="team-mates"></div><button class="team-more"></button>';
    row.appendChild(team);
  }
  const mates = team.querySelector('.team-mates');
  const shown = subs.slice(-TEAM_MAX);
  const keep = new Set(shown.map((a) => a.id));
  for (const m of [...mates.children]) if (!keep.has(m.dataset.id)) { teamPoof(m); m.remove(); }

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
    const pose = a.finished ? 'done' : activityPose(a.tool ? { kind: 'tool', tool: a.tool } : { kind: 'thinking' });
    const bot = m.querySelector('.team-bot');
    if (bot.dataset.look !== pose && typeof window.buildRunnerSvg === 'function') {
      bot.dataset.look = pose;
      bot.innerHTML = window.buildRunnerSvg(teamHue(a.type), null, pose) +
        (pose === 'done' ? '<span class="act-bubble ok">✓</span>' : pose === 'think' ? '<span class="act-bubble"><i></i><i></i><i></i></span>' : '');
      m.className = `team-mate pose-${pose}`;
    }
    m.querySelector('.team-tag').textContent = a.type;
    m.querySelector('.team-task').textContent = a.task;
    m.title = `${a.type}: ${a.task}` + (a.finished ? '\n✓ Done' : a.tool ? `\nNow: ${a.tool}${a.target ? ' ' + a.target : ''}` : '\nNow: thinking');
    if (isNew) requestAnimationFrame(() => {
      const r = bot.getBoundingClientRect();
      if (r.width) smokePuff(r.left + r.width / 2, r.top + r.height / 2, 30);
    });
  }
  const more = team.querySelector('.team-more');
  const extra = subs.length - shown.length;
  more.style.display = extra > 0 ? '' : 'none';
  more.textContent = `+${extra}`;
  more.title = subs.slice(0, extra).map((a) => `${a.type}: ${a.task}`).join('\n');
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
  const working = s && !isAttn && !s.deliveryFailed && (s.status === 'running' || s.context?.compacting);
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
          (cur.status === 'running' || cur.context?.compacting);
        if (still) return;
        avatarJumpBack(row);
        row.style.display = 'none';
        if (cur) { activityFirstSeen.delete(cur.id); activityTrail.delete(cur.id); }
        activityTrailOpen = false;
        if (activityTimer) { clearInterval(activityTimer); activityTimer = null; }
      }, 1500);
    }
    return;
  }
  if (activityHideTimer) { clearTimeout(activityHideTimer); activityHideTimer = null; }
  if (!activityFirstSeen.has(s.id)) activityFirstSeen.set(s.id, Date.now());

  const agent = agentLabel(s.source, s.id);
  const act = currentActivity(s);
  const { verb, target } = describeActivity(act, agent);
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

// ===========================================================================
// Claude commands, MCP servers & tool approvals
// ===========================================================================
const replyOptionsEl = document.getElementById('replyOptions');
const slashMenu = document.getElementById('slashMenu');
const btnMcp = document.getElementById('btnMcp');
const mcpPanel = document.getElementById('mcpPanel');
const mcpList = document.getElementById('mcpList');
const btnMcpRefresh = document.getElementById('btnMcpRefresh');

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable', 'opusplan'];

// Commands the HUD handles itself (they only exist in the interactive CLI)
// or passes straight through to `claude -p`.
// Commands with `options` open a nested choice list when picked.
const BUILTIN_COMMANDS = [
  {
    name: 'model', args: '›', description: 'Model for your next replies in this session', kind: 'hud',
    current: (s, o) => o.model || 'default',
    options: [
      { value: 'default', description: 'Use the session’s model' },
      { value: 'opus', description: 'Most capable' },
      { value: 'sonnet', description: 'Fast and capable' },
      { value: 'haiku', description: 'Fastest' },
      { value: 'fable', description: 'Fable' },
      { value: 'opusplan', description: 'Opus plans · Sonnet executes (use with 📝 Plan)' },
    ],
  },
  {
    name: 'effort', args: '›', description: 'Reasoning effort for your next replies', kind: 'hud',
    current: (s, o) => o.effort || 'default',
    options: [
      { value: 'default', description: 'Use the session’s effort' },
      { value: 'low', description: 'Quickest answers' },
      { value: 'medium', description: 'Balanced' },
      { value: 'high', description: 'Think harder' },
      { value: 'xhigh', description: 'Think much harder' },
      { value: 'max', description: 'Maximum reasoning' },
    ],
  },
  { name: 'clear', args: '', description: 'Open a new, empty conversation in the same folder', kind: 'hud' },
  { name: 'mcp', args: '', description: 'Show MCP servers and their status', kind: 'hud' },
  { name: 'help', args: '', description: 'List available commands', kind: 'hud' },
  { name: 'compact', args: '[instructions]', description: 'Summarize the conversation to free up context', kind: 'claude' },
  { name: 'init', args: '', description: 'Create a CLAUDE.md for this project', kind: 'claude' },
  { name: 'plan', args: '[goal]', description: 'Step-by-step planning before execution', kind: 'antigravity' },
  { name: 'goal', args: '[goal]', description: 'Thorough autonomous execution until the goal is achieved', kind: 'antigravity' },
  { name: 'boost', args: '[task]', description: 'Deep thinking, strategic planning & rigorous verification', kind: 'antigravity' },
  { name: 'teamwork', args: '[task]', description: 'Coordinate a swarm of autonomous agents in parallel', kind: 'antigravity' },
  { name: 'grill-me', args: '[topic]', description: 'Interactive interview to resolve design decisions', kind: 'antigravity' },
  { name: 'schedule', args: '[when]', description: 'Run an instruction on a recurring schedule or timer', kind: 'antigravity' },
  { name: 'browser', args: '[task]', description: 'Browse or interact with web applications', kind: 'antigravity' },
  { name: 'learn', args: '[lesson]', description: 'Persist a workflow or correction for future tasks', kind: 'antigravity' },
];

// ---- per-session overrides for the next reply ----
const replyOptions = new Map(); // sessionId -> { model, effort, newSession }

function getReplyOptions(session) {
  if (!session) return {};
  if (!replyOptions.has(session.id)) replyOptions.set(session.id, {});
  return replyOptions.get(session.id);
}

// Options to send with this reply; /clear only applies once
function takeReplyOptions(session) {
  if (!session) return {};
  if (session.source !== 'claude' && session.source !== 'antigravity') return {};
  const opts = getReplyOptions(session);
  const out = { model: opts.model, effort: opts.effort, newSession: !!opts.newSession, plan: !!opts.plan };
  // Plan first: the planning message always uses the plan model, and the
  // "implement it" message right after approval uses the execute model (one-shot)
  if (opts.oneShotModel) { out.model = opts.oneShotModel; delete opts.oneShotModel; }
  else if (opts.plan && session.source === 'claude' && window.fxPlanModels) out.model = window.fxPlanModels.plan;
  if (session.draft && !session.draftSent) { out.newSession = true; session.draftSent = true; }
  opts.newSession = false;
  renderReplyOptions();
  return out;
}

function renderReplyOptions() {
  if (!replyOptionsEl) return;
  const s = currentActiveSession;
  const opts = s && (s.source === 'claude' || s.source === 'antigravity') ? getReplyOptions(s) : {};
  replyOptionsEl.innerHTML = '';
  const chips = [];
  if (opts.model) chips.push({ key: 'model', label: `Model: ${opts.model}` });
  if (opts.effort) chips.push({ key: 'effort', label: `Effort: ${opts.effort}` });
  if (opts.newSession) chips.push({ key: 'newSession', label: 'Next message starts a new conversation' });
  if (!chips.length) { replyOptionsEl.style.display = 'none'; return; }

  const lead = document.createElement('span');
  lead.className = 'reply-options-lead';
  lead.textContent = 'Next reply:';
  replyOptionsEl.appendChild(lead);
  for (const c of chips) {
    const chip = document.createElement('span');
    chip.className = 'reply-option-chip';
    chip.textContent = c.label;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'Remove';
    x.addEventListener('click', () => { delete opts[c.key]; renderReplyOptions(); });
    chip.appendChild(x);
    replyOptionsEl.appendChild(chip);
  }
  replyOptionsEl.style.display = '';
}

// Small grey system line in the conversation (not sent anywhere)
function addSystemNote(text) {
  const note = document.createElement('div');
  note.className = 'chat-note';
  note.textContent = text;
  chatStream.appendChild(note);
  chatStream.scrollTop = chatStream.scrollHeight;
}

// New chat: open an empty conversation for the same folder right away. The
// first message starts a fresh Claude session (no --resume); as soon as
// Claude names it, this window becomes that session (see onReplyRekey).
// `folder` (optional) = another workspace picked in "New chat ▾"; without an
// open conversation, pass from = null and both `as` and `folder`.
function startNewChat(from, as, folder) {
  if (!from && folder && (as === 'claude' || as === 'antigravity')) from = { source: as, cwd: folder };
  if (!from || !['claude', 'antigravity'].includes(from.source)) return;
  const source = as === 'claude' || as === 'antigravity' ? as : from.source;
  const cwd = folder || from.cwd;
  const sameFolder = !folder || folder === from.cwd;
  const project = sameFolder && from.project ? from.project
    : (String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || cwd);
  // already a blank new chat with that agent in that folder
  if (from.draft && !from.draftSent && from.source === source && sameFolder) { replyTextarea.focus(); return; }
  // /model and /effort carry over when starting a new chat with the same agent
  const fromOpts = from.source === source ? getReplyOptions(from) : {};
  const draft = {
    id: `${source}_draft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    sessionUuid: '',
    draft: true,
    draftSent: false,
    source,
    cwd,
    project,
    sessionTitle: 'New conversation',
    model: source === from.source ? (fromOpts.model || from.model) : undefined,
    effort: source === from.source ? (fromOpts.effort || from.effort) : undefined,
    status: 'idle',
    state: 'idle',
    statusLabel: 'Idle',
    unread: false,
    fullContent: '',
    detail: '',
    context: null,
    activity: null,
    mtime: Date.now(),
  };
  // carry /model and /effort overrides over to the new conversation
  const opts = {};
  if (fromOpts.model) opts.model = fromOpts.model;
  if (fromOpts.effort) opts.effort = fromOpts.effort;
  replyOptions.set(draft.id, opts);
  showDetailView(draft);
}

// The New-chat run got its real session id from Claude: re-key everything the
// HUD tracks for the draft, so the open window simply continues as that session.
if (window.electronAPI.onReplyRekey) {
  window.electronAPI.onReplyRekey(({ oldId, newId, sessionUuid }) => {
    const move = (map) => { if (map.has(oldId)) { map.set(newId, map.get(oldId)); map.delete(oldId); } };
    move(sessionChatHistory);
    move(replyOptions);
    move(liveActivity);
    move(activityFirstSeen);
    for (const req of pendingApprovals.values()) if (req.sessionId === oldId) req.sessionId = newId;
    if (currentActiveSession && currentActiveSession.id === oldId) {
      currentActiveSession.id = newId;
      currentActiveSession.sessionUuid = sessionUuid;
      currentActiveSession.draft = false; // later messages resume this session
      // if the watcher already found the new transcript, switch to it now
      const real = sessionsList.find((x) => x.id === newId);
      if (real) currentActiveSession = Object.assign(real, { status: 'running' });
      updateConvoHeader(currentActiveSession);
    }
  });
}

// Returns true if the HUD handled the command itself
function runHudCommand(input) {
  const m = input.match(/^\/(\S+)\s*([\s\S]*)$/);
  if (!m) return false;
  const name = m[1].toLowerCase();
  const arg = m[2].trim();
  const s = currentActiveSession;

  if (name === 'help') {
    const src = s?.source || 'claude';
    const custom = (slashCache.get(`${src}:${s?.cwd || ''}`) || []).map((c) => `/${c.name}`);
    const agentCmds = BUILTIN_COMMANDS
      .filter((c) => src === 'antigravity' ? (c.kind === 'antigravity' || c.name === 'compact') : c.kind === 'claude')
      .map((c) => `/${c.name}`);
    addSystemNote(
      'HUD commands: ' + BUILTIN_COMMANDS.filter((c) => c.kind === 'hud').map((c) => `/${c.name}`).join('  ') +
      `\nSent to ${src === 'antigravity' ? 'Antigravity' : 'Claude'}: ` + agentCmds.join('  ') +
      (custom.length ? '\nYour commands & skills: ' + custom.join('  ') : '')
    );
    return true;
  }
  if (name === 'mcp') { openMcpPanel(); return true; }

  if (!s || (s.source !== 'claude' && s.source !== 'antigravity')) {
    if (['model', 'effort', 'clear'].includes(name)) {
      addSystemNote(`/${name} only works for Claude Code and Antigravity sessions.`);
      return true;
    }
    return false;
  }
  const opts = getReplyOptions(s);

  if (name === 'model') {
    if (!arg) {
      addSystemNote(`Current model: ${opts.model || formatModelName(s.model) || 'default'}. Usage: /model <${MODEL_ALIASES.join('|')}|model-id|default>`);
    } else if (arg === 'default') {
      delete opts.model;
      addSystemNote('Model reset — replies use the session default.');
    } else {
      opts.model = arg;
      addSystemNote(`Model set to ${arg} for your next replies in this session.`);
    }
    renderReplyOptions();
    return true;
  }
  if (name === 'effort') {
    const level = arg.toLowerCase();
    if (!level) {
      addSystemNote(`Current effort: ${opts.effort || s.effort || 'default'}. Usage: /effort <${EFFORT_LEVELS.join('|')}|default>`);
    } else if (level === 'default') {
      delete opts.effort;
      addSystemNote('Effort reset to default.');
    } else if (EFFORT_LEVELS.includes(level)) {
      opts.effort = level;
      addSystemNote(`Effort set to ${level} for your next replies in this session.`);
    } else {
      addSystemNote(`Unknown effort "${arg}". Use one of: ${EFFORT_LEVELS.join(', ')}.`);
    }
    renderReplyOptions();
    return true;
  }
  if (name === 'clear') {
    startNewChat(s);
    return true;
  }
  return false; // /compact, /init, /plan, /goal, custom commands & skills → sent to the agent as-is
}

// ---- "/" autocomplete ----
const slashCache = new Map(); // "source:cwd" -> custom commands/skills
let agySlashModelOptions = null;
let slashItems = [];
let slashIndex = 0;

async function loadSlashCommands(cwd, forceOrSource = false, maybeSource = undefined) {
  const force = typeof forceOrSource === 'boolean' ? forceOrSource : false;
  const source = typeof forceOrSource === 'string'
    ? forceOrSource
    : (maybeSource !== undefined ? maybeSource : currentActiveSession?.source);
  const src = source === 'antigravity' ? 'antigravity' : 'claude';
  const key = `${src}:${cwd || ''}`;
  if (!force && slashCache.has(key)) return slashCache.get(key);
  let list = [];
  try { list = (await window.electronAPI.listSlashCommands(cwd, src)) || []; } catch (e) {}
  slashCache.set(key, list);
  return list;
}

async function getAgySlashModelOptions() {
  if (agySlashModelOptions) return agySlashModelOptions;
  const fallback = [
    { value: 'default', description: 'Use the session’s model' },
    { value: 'opus', description: 'Claude Opus' },
    { value: 'sonnet', description: 'Claude Sonnet' },
    { value: 'gemini-4-argon-medium', description: 'Gemini 4 Argon' },
    { value: 'gpt-oss-120b-medium', description: 'GPT-OSS 120B' },
  ];
  try {
    const r = await window.electronAPI.agyModels?.();
    const list = Array.isArray(r) ? r : r?.models;
    if (Array.isArray(list) && list.length) {
      agySlashModelOptions = [
        { value: 'default', description: 'Use the session’s model' },
        ...list.map((m) => ({ value: m.id || m.slug, description: m.name || m.id || m.slug })),
      ];
      return agySlashModelOptions;
    }
  } catch (e) {}
  return fallback;
}

function hideSlashMenu() {
  slashMenu.style.display = 'none';
  slashItems = [];
  slashParent = null;
}

let slashParent = null; // command whose nested options are shown (e.g. /effort)

async function updateSlashMenu() {
  if (!currentActiveSession) return hideSlashMenu();
  const isClaude = currentActiveSession.source === 'claude';
  const isAgy = currentActiveSession.source === 'antigravity';

  // Level 2: "/effort " or "/model " → nested options of that command
  const sub = replyTextarea.value.match(/^\/(\S+)\s+(\S*)$/);
  if (sub && (isClaude || isAgy)) {
    const parent = BUILTIN_COMMANDS.find((c) => c.name === sub[1].toLowerCase() && c.options);
    if (parent) {
      const q2 = sub[2].toLowerCase();
      if (slashParent !== parent) slashIndex = 0;
      slashParent = parent;
      const current = parent.current(currentActiveSession, getReplyOptions(currentActiveSession));
      const optsList = (isAgy && parent.name === 'model') ? await getAgySlashModelOptions() : parent.options;
      slashItems = optsList
        .filter((o) => o.value.toLowerCase().includes(q2) || (o.description || '').toLowerCase().includes(q2))
        .map((o) => ({ ...o, isOption: true, selected: o.value === current }));
      if (!slashItems.length) return hideSlashMenu();
      // Start on the current choice when the list first opens
      if (!q2 && slashIndex === 0) slashIndex = Math.max(0, slashItems.findIndex((o) => o.selected));
      slashIndex = Math.min(slashIndex, slashItems.length - 1);
      return renderSlashMenu();
    }
  }
  slashParent = null;

  // Level 1: "/eff" → matching commands
  const m = replyTextarea.value.match(/^\/(\S*)$/);
  if (!m) return hideSlashMenu();
  const q = m[1].toLowerCase();
  const custom = (isClaude || isAgy) ? await loadSlashCommands(currentActiveSession.cwd, currentActiveSession.source) : [];
  // Still the same query after the await?
  if (!replyTextarea.value.match(/^\/(\S*)$/)) return hideSlashMenu();

  const builtins = BUILTIN_COMMANDS.filter((c) => {
    if (c.kind === 'hud') return true;
    if (isClaude) return c.kind === 'claude';
    if (isAgy) return c.kind === 'antigravity' || c.name === 'compact';
    return c.name === 'help' || c.name === 'mcp';
  });
  const all = [
    ...builtins,
    ...custom.filter((c) => !builtins.some((b) => b.name === c.name)),
  ];
  slashItems = all
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)))
    .slice(0, 30);
  if (!slashItems.length) return hideSlashMenu();
  slashIndex = Math.min(slashIndex, slashItems.length - 1);
  renderSlashMenu();
}

function renderSlashMenu() {
  slashMenu.innerHTML = '';
  if (slashParent) return renderSlashOptions();
  slashItems.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = `slash-item ${i === slashIndex ? 'active' : ''}`;
    const nameEl = document.createElement('span');
    nameEl.className = 'slash-name';
    nameEl.textContent = `/${c.name}`;
    const argsEl = document.createElement('span');
    argsEl.className = 'slash-args';
    argsEl.textContent = c.args || '';
    const desc = document.createElement('span');
    desc.className = 'slash-desc';
    desc.textContent = c.description || '';
    const tag = document.createElement('span');
    tag.className = `slash-tag tag-${c.kind}`;
    tag.textContent = c.kind === 'hud' ? 'HUD' : c.kind === 'claude' ? 'Claude' : c.kind === 'antigravity' ? 'Antigravity' : c.kind;
    item.append(nameEl, argsEl, desc, tag);
    item.addEventListener('mousedown', (e) => { e.preventDefault(); pickSlash(i); });
    slashMenu.appendChild(item);
  });
  slashMenu.style.display = '';
  slashMenu.querySelector('.slash-item.active')?.scrollIntoView({ block: 'nearest' });
}

// Nested options view:  ‹ /effort   Reasoning effort…
//                        ✓ medium   Balanced
function renderSlashOptions() {
  const head = document.createElement('div');
  head.className = 'slash-sub-head';
  const back = document.createElement('span');
  back.className = 'slash-back';
  back.textContent = `‹ /${slashParent.name}`;
  back.title = 'Back to commands';
  back.addEventListener('mousedown', (e) => { e.preventDefault(); slashGoBack(); });
  const hint = document.createElement('span');
  hint.className = 'slash-sub-desc';
  hint.textContent = slashParent.description;
  head.append(back, hint);
  slashMenu.appendChild(head);

  slashItems.forEach((o, i) => {
    const item = document.createElement('div');
    item.className = `slash-item slash-option ${i === slashIndex ? 'active' : ''} ${o.selected ? 'selected' : ''}`;
    const check = document.createElement('span');
    check.className = 'slash-check';
    check.textContent = o.selected ? '✓' : '';
    const nameEl = document.createElement('span');
    nameEl.className = 'slash-name';
    nameEl.textContent = o.value;
    const desc = document.createElement('span');
    desc.className = 'slash-desc';
    desc.textContent = o.description || '';
    item.append(check, nameEl, desc);
    item.addEventListener('mousedown', (e) => { e.preventDefault(); pickSlash(i); });
    slashMenu.appendChild(item);
  });
  slashMenu.style.display = '';
  slashMenu.querySelector('.slash-item.active')?.scrollIntoView({ block: 'nearest' });
}

function slashGoBack() {
  const name = slashParent ? slashParent.name : '';
  slashParent = null;
  replyTextarea.value = `/${name}`;
  slashIndex = 0;
  replyTextarea.focus();
  updateSlashMenu();
}

function pickSlash(i) {
  const c = slashItems[i];
  if (!c) return;

  // Picked a nested option → apply it right away (e.g. /effort high)
  if (c.isOption && slashParent) {
    const cmd = `/${slashParent.name} ${c.value}`;
    replyTextarea.value = '';
    hideSlashMenu();
    slashParent = null;
    runHudCommand(cmd);
    replyTextarea.focus();
    return;
  }

  replyTextarea.value = `/${c.name} `;
  replyTextarea.focus();
  if (c.options && (currentActiveSession?.source === 'claude' || currentActiveSession?.source === 'antigravity')) {
    slashIndex = 0;
    updateSlashMenu(); // open the nested options
  } else {
    hideSlashMenu();
  }
}

function slashMenuHandleKey(e) {
  if (slashMenu.style.display === 'none' || !slashItems.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : -1;
    slashIndex = (slashIndex + d + slashItems.length) % slashItems.length;
    renderSlashMenu();
    return true;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault();
    pickSlash(slashIndex);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (slashParent) slashGoBack(); // first Esc goes back a level
    else hideSlashMenu();
    return true;
  }
  if (e.key === 'ArrowLeft' && slashParent && /\s$/.test(replyTextarea.value)) {
    e.preventDefault();
    slashGoBack();
    return true;
  }
  return false;
}

replyTextarea.addEventListener('input', () => { slashIndex = 0; updateSlashMenu(); });
replyTextarea.addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement !== replyTextarea) hideSlashMenu(); // toolbar buttons refocus it
}, 120));

// ---- MCP servers panel ----
// "＋ Add server": http / sse (URL) or stdio (command + args), for all projects or this folder
function mcpAddForm(s) {
  const mk = (tag, cls, props) => Object.assign(document.createElement(tag), { className: cls || '' }, props || {});
  const box = mk('details', 'mcp-add');
  box.appendChild(mk('summary', '', { textContent: '＋ Add server' }));
  const type = mk('select', 'mcp-in');
  for (const [v, l] of [['http', 'HTTP (URL)'], ['sse', 'SSE (URL)'], ['stdio', 'Command']]) type.appendChild(mk('option', '', { value: v, textContent: l }));
  const name = mk('input', 'mcp-in', { placeholder: 'name (e.g. sentry)' });
  const target = mk('input', 'mcp-in', { placeholder: 'https://… or command' });
  const args = mk('input', 'mcp-in', { placeholder: 'arguments (command only)' });
  const scope = mk('select', 'mcp-in');
  for (const [v, l] of [['user', 'All my projects'], ['local', 'This folder (private)'], ['project', 'This folder (shared .mcp.json)']]) scope.appendChild(mk('option', '', { value: v, textContent: l }));
  const go = mk('button', 'mcp-act', { textContent: 'Add' });
  const msg = mk('div', 'mcp-hint');
  const sync = () => { args.style.display = type.value === 'stdio' ? '' : 'none'; };
  type.addEventListener('change', sync);
  sync();
  box.addEventListener('keydown', (e) => e.stopPropagation());
  go.addEventListener('click', async () => {
    go.disabled = true;
    msg.textContent = 'Adding…';
    const r = await window.electronAPI.mcpAdd({ transport: type.value, name: name.value.trim(), target: target.value, args: args.value, scope: scope.value, cwd: s?.cwd, source: s?.source });
    go.disabled = false;
    if (r.ok) loadMcp(true); else msg.textContent = r.message || 'Could not add it.';
  });
  box.append(type, name, target, args, scope, go, msg);
  return box;
}
async function loadMcp(refresh = false) {
  const s = currentActiveSession;
  const isAgy = s?.source === 'antigravity';
  mcpList.innerHTML = '<div class="mcp-empty">Checking servers… (this can take a few seconds)</div>';
  let result;
  try { result = await window.electronAPI.listMcpServers(s?.cwd, refresh, s?.source); }
  catch (e) { result = { servers: [], error: e.message }; }
  if (currentActiveSession !== s) return;

  mcpList.innerHTML = '';
  if (!result.servers || !result.servers.length) {
    const empty = document.createElement('div');
    empty.className = 'mcp-empty';
    empty.textContent = result.error ? `Couldn't run "${isAgy ? 'agy' : 'claude'} mcp list": ${result.error}` : (result.raw || 'No MCP servers configured.');
    mcpList.appendChild(empty);
    mcpList.appendChild(mcpAddForm(s));
    return;
  }
  for (const srv of result.servers) {
    const row = document.createElement('div');
    row.className = `mcp-row mcp-${srv.status}`;
    const dot = document.createElement('span');
    dot.className = 'mcp-dot';
    const name = document.createElement('span');
    name.className = 'mcp-name';
    name.textContent = srv.name;
    name.title = srv.detail;
    const st = document.createElement('span');
    st.className = 'mcp-status';
    st.textContent = srv.statusText;
    row.append(dot, name, st);
    const btn = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'mcp-act';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
      row.appendChild(b);
    };
    // needs sign-in / failed: open Claude Code / Antigravity to sign in or reconnect it
    if (srv.status === 'auth' || srv.status === 'failed') {
      btn('Sign in', `Opens ${isAgy ? 'Antigravity' : 'Claude Code'} in a console to sign in or reconnect`, () => window.electronAPI.mcpSignin({ cwd: s?.cwd, source: s?.source }));
    }
    // claude.ai connectors are managed on claude.ai, not by the CLI
    if (!/^claude\.ai\b/i.test(srv.name)) {
      btn('✕', 'Remove this server', async (b) => {
        if (b.textContent !== 'Sure?') { b.textContent = 'Sure?'; setTimeout(() => { b.textContent = '✕'; }, 3000); return; }
        const r = await window.electronAPI.mcpRemove({ name: srv.name, cwd: s?.cwd, source: s?.source });
        if (r.ok) loadMcp(true); else b.title = r.message || 'Could not remove';
      });
    }
    mcpList.appendChild(row);
  }
  mcpList.appendChild(mcpAddForm(s));
  const hint = document.createElement('div');
  hint.className = 'mcp-hint';
  hint.textContent = 'Replies sent from the HUD can use these. Tools that need permission will ask you here.';
  mcpList.appendChild(hint);
}

function openMcpPanel() {
  closeUsagePanel();
  mcpPanel.style.display = '';
  loadMcp(false);
}

btnMcp?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (mcpPanel.style.display === 'none') openMcpPanel();
  else mcpPanel.style.display = 'none';
});
btnMcpRefresh?.addEventListener('click', (e) => { e.stopPropagation(); loadMcp(true); });
document.addEventListener('click', (e) => {
  if (mcpPanel.style.display !== 'none' && !mcpPanel.contains(e.target) && e.target !== btnMcp) {
    mcpPanel.style.display = 'none';
  }
});

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

// One answer path for both the in-chat card and the notification toast
function answerApproval(req, choice) {
  if (!pendingApprovals.has(req.id)) return;
  window.electronAPI.respondPermission(req.id, choice);
  pendingApprovals.delete(req.id);
  if (currentActiveSession) updateConvoHeader(currentActiveSession);
  resolveApprovalCard(req.id, choice === 'deny' ? 'Denied' : choice === 'always' ? `Allowed — rule saved: always allow ${alwaysLabel(req)} in this folder` : 'Allowed');
  renderApprovalToasts();
}

// Is this request's conversation open on screen right now?
function isApprovalInView(req) {
  return isExpanded && document.body.classList.contains('in-detail') &&
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
    const box = document.getElementById('approvalToasts');
    box?.classList.remove('flash'); void box?.offsetWidth; box?.classList.add('flash');
    if (currentActiveSession) updateConvoHeader(currentActiveSession);
  });
  window.electronAPI.onPermissionExpired(({ id }) => {
    pendingApprovals.delete(id);
    resolveApprovalCard(id, 'Expired');
    renderApprovalToasts();
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
  document.getElementById('convoStatus').textContent = `(${friendlyStatus(s, state)})`;
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
