# How ovly-claude works

Four diagrams, from the big picture down. They render in VS Code's Markdown preview and on GitHub.

## 1. Big picture

```mermaid
flowchart LR
  subgraph Agents["AI agents (outside the app)"]
    CC["Claude Code"]
    AG["Antigravity"]
  end
  subgraph Disk["Log files"]
    CL["~/.claude/projects/*.jsonl"]
    GL["~/.gemini/antigravity*/"]
  end
  subgraph Main["Electron main process"]
    W["watcher.js<br/>polls every 0.8s"]
    M["main.js<br/>windows, send-reply"]
    P["main/ipc/permissions.js<br/>approval server + rules"]
    F["features-main.js<br/>settings, search, git, costs"]
  end
  subgraph UI["Renderer (ui/)"]
    PL["preload.js<br/>window.electronAPI"]
    A["app.js + ui/logic/*<br/>cards, chat, Vault"]
  end

  CC -- writes --> CL
  AG -- writes --> GL
  CL --> W
  GL --> W
  W -- "sync / alert" --> M
  M -- "sessions-sync, session-alert" --> PL --> A
  A -- "send-reply, settings…" --> PL --> M
  PL --> F
  M -- "spawn claude -p / agy" --> CC
  M -- spawn --> AG
  CC -. "permission request" .-> P -- "permission-request" --> PL
```

The app never talks to an AI service directly. It **reads the agents' log files** to show status, and **starts the agents' CLIs** to send messages.

## 2. Sending a message

```mermaid
sequenceDiagram
  participant U as You (chat input)
  participant R as app.js
  participant M as main.js
  participant C as claude -p
  participant W as watcher.js

  U->>R: type + Enter
  R->>M: send-reply {text, images, files, session}
  M->>W: setSessionRunning (card shows "Running")
  M->>C: spawn claude -p --resume <id><br/>--output-format stream-json<br/>--permission-prompt-tool mcp__ovly_hud__approve
  loop while Claude works
    C-->>M: stream-json lines (text, tool use)
    M-->>R: reply-stream (live text)
    C-->>W: also appends to the .jsonl log
  end
  alt new chat
    M-->>R: reply-rekey (draft id → real session id)
  end
  C-->>M: result / exit (or error, e.g. API 403)
  M->>W: cancelRunning (never stuck on "thinking")
  M-->>R: reply-status idle (or "⚠ error")
```

Antigravity takes the same path using `agy` instead of `claude -p`. If `agy` is not installed, the app pastes the message into the Antigravity window as a fallback.

## 3. Tool approvals

```mermaid
flowchart TD
  C["claude -p wants to run a tool<br/>(Bash, Edit, MCP…)"] --> MCP["mcp/permission.js<br/>(tiny MCP server)"]
  MCP -- "HTTP POST + token" --> S["permissions.js server<br/>127.0.0.1:random port"]
  S --> R{"Saved rule matches?<br/>~/.ovly-claude/approval-rules.json"}
  R -- yes --> OK["allow automatically"]
  R -- no --> Card["Approval card in the HUD"]
  Card -- "Allow" --> OK
  Card -- "Always allow …" --> Save["save rule<br/>(command prefix or whole folder)"] --> OK
  Card -- "Deny" --> NO["deny + message"]
  Card -- "no answer in 10 min" --> NO
  OK --> C
  NO --> C
```

Saved rules can be reviewed and deleted in **Settings → Approval rules** (`ui/logic/system/rules.js`).

## 4. Session status

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Running: new user message or send-reply
  Running --> Running: tool_use / tool_result
  Running --> Question: last reply ends with a question
  Running --> Idle: end_turn
  Running --> Idle: API error entry (isApiErrorMessage)
  Running --> Idle: CLI exits (cancelRunning)
  Question --> Running: user answers
  Question --> Idle: dismissed
```

`watcher.js` works this out from the log on every poll. A **Question** raises a `session-alert`: the HUD expands and plays a chime.

## Where to look

| Area | File |
|---|---|
| Reading logs, session state | `watcher.js` |
| Windows, sending messages, MCP list | `main.js` |
| Approvals and rules | `main/ipc/permissions.js`, `mcp/permission.js`, `approval-shell.js` |
| Settings, search, git, costs | `features-main.js` |
| Bridge between main and UI | `preload.js` |
| Main UI | `ui/app.js` |
| Chat extras, nav, Vault, themes | `ui/logic/*`, `ui/styles/*` |
