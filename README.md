# ovly-claude: a desktop HUD for Claude Code (and Antigravity)

A small always-on-top Windows window that watches your **Claude Code** chats (and **Antigravity** agent chats), tells you when one needs you, and lets you **reply, approve tool use, review and commit changes** without leaving it.

It reads the logs Claude Code already writes (`~/.claude/projects/`, and `~/.gemini/…/brain/` for Antigravity). It does not need an API key. Replies you send from the HUD run the `claude` command on your PC (`claude -p`, resuming the chat).

---

## What it does

**Watch**
- One card or row per chat, with a live status: *Running* (thinking / which tool), *Idle*, *Needs input*. Filter by All, Running, Idle, Needs input.
- Chime and a pop-out when a chat asks a question, needs an approval, or finishes. Desktop notification when a long run ends.
- Docks to a screen edge as a small tab. System-tray menu to reset size and position.
- Context meter per chat, cost of the chat (`$…`), tokens used today, and a **Usage** panel (tokens per day, plan limits).

**Reply**
- Full conversation view with Markdown, syntax-coloured code, and **Mermaid diagrams** (ask Claude for "a Mermaid diagram of…").
- Attach images and files (paste, drag, paperclip). Slash commands and your own skills: type `/`.
- **Model per message:** the Model menu has *This message* (one-off, e.g. Haiku for a quick question) and *Every message*. Effort works the same way.
- **Plan** mode, a message queue while Claude is busy, **Stop** that really stops, and a **Hand off ↗** button (or `/handoff`) that writes a short note from a long chat and opens a fresh chat with it, which keeps long chats cheap.
- Remote Control, pinned notes, Ctrl+K finder, search across all chats, export a chat to Markdown.

**Approve**
- Claude's tool requests appear in the HUD with **Allow / Allow always / Deny**. "Always" saves a narrow rule (for example `npm test`). Rules never cover chained or hidden commands, and delete / kill / download-and-run commands never get a rule.
- *Always allow all commands in this folder* is available for shell commands. It still asks for delete, kill, downloads, `| sh`, `git push`, `git reset --hard` and `git clean`.
- Manage or delete rules in Settings → Approval rules.

**Review and ship** (click the git box in the chat header)
- A side panel with every changed file as a **folder tree** and a coloured diff.
- Pick lines or select text and **Add to chat**. Right-click a file or folder for **Explain this change**.
- Tick files, then **Commit** (Claude can draft the message, optional push, optional GitHub account for the push) or **Discard** (backed up for a week, with Undo).

**Looks**
- Three styles: **Classic** (Windows 7, XP, Vista Dark themes), **Work** (sidebar + chat) and **Shelter** (rooms with robots). Maximize with the title-bar button, double-click on the header, or `Ctrl+Shift+M`.

---

## Quick start

Windows, Node.js, and Claude Code installed (VS Code extension or `claude` on your PATH).

```bash
npm install
npm start
```

Or double-click **`Launch AI HUD.vbs`** (no console window). The app also creates a desktop shortcut the first time it runs. Global hotkey: `Ctrl+Alt+Space` brings the HUD up with the cursor in the input box.

## Tests

```bash
npm test
```

Runs `tests/` with Node's built-in test runner (no extra packages): the approval-rule parser and the git actions behind the Changes panel.

## Safety notes

- Replies are cleaned before they are shown (scripts, event handlers, `javascript:` links, forms and frames are removed, and remote images become links), and the page has a strict Content-Security-Policy. See `ui/logic/chat/safe-markdown.js`.
- Settings, approval rules and discard backups live in `~/.ovly-claude/`.
- The **Usage** panel reads your Claude login token from `~/.claude/.credentials.json` to ask Anthropic for plan limits. Nothing else uses it.
- Commit messages and hand-off notes are written by a one-off `claude -p --model haiku` call. It runs from the temp folder, does not save a chat, and may cost a little.

## Project structure

- `main.js`: Electron main process: window, tray, docking, sending replies.
- `main/`: main-process parts: `ipc/` (approvals, clipboard, snapshots), `notes.js`, `git.js` and `proc.js` (git and one-off process helpers).
- `features-main.js`: settings store, history, search, notifications, remote control, hand-off note.
- `watcher.js`: reads Claude Code and Antigravity logs and works out each chat's state.
- `approval-shell.js`: splits shell commands and decides what an "Always allow" rule may cover.
- `usage.js`: token and plan-limit numbers. `skill-install-main.js`: skill installer.
- `preload.js`: the only bridge between the page and the main process.
- `mcp/`: small MCP servers Claude runs: `permission.js` (approval prompts) and `pinner.js` (pin notes).
- `ui/`: the interface. `app.js` (core), `features.js`, `logic/` by area (`chat/`, `nav/`, `system/`, `vault/`, `personalization/`), `lib/` (Markdown, Mermaid, highlighting, robots), `styles/`.
- `tests/`: automated tests. `docs/FLOW.md`: how the app works, with diagrams.

More detail, with diagrams: [`docs/FLOW.md`](docs/FLOW.md).
