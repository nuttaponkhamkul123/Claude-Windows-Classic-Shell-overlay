# Claude & Antigravity Desktop Overlay HUD 🚀

A lightweight, frosted-glass, always-on-top desktop overlay that monitors **Claude Code (extension in Antigravity / VS Code)** and **Antigravity IDE Agent** in real-time.

It provides an ambient status pill and **automatically alerts you with sound and an expanded popup whenever Claude or Antigravity is asking for confirmation, asking a question, or finished a turn**.

---

## ✨ Features

- 🪟 **Floating Frameless Glass HUD**: Translucent obsidian frosted glass with neon glow borders.
- 📐 **Fully Resizable**:
  - Drag from any window edge or use the corner grip handle at the bottom-right (`///`).
  - Supports width from 320px to 1400px and height up to 1200px.
  - Remembers your custom width/height when expanding and collapsing.
  - Reset size anytime from the system tray menu (`Reset Size & Position`).
- 🖐️ **Draggable Anywhere**: Drag and place the widget anywhere on your screens.
- 📌 **Always-on-Top Toggle**: Pin or unpin easily from the HUD.
- 🔔 **Attention Popup & Audio Chime**:
  - Automatically pulses amber and expands when Claude/Antigravity asks a question or requires input.
  - Plays a crisp, pleasant dual-tone chime (synthesized via Web Audio API, 100% offline).
- ⚙️ **Real-Time State Indicators**:
  - 🟢 **Ready / Idle**: Calmed green indicator.
  - 🟡 **Thinking / Processing**: Electric blue/purple pulse.
  - ⚙️ **Running Tool**: Cyan indicator showing active tool (e.g. `Bash`, `Edit`).
  - 🔔 **Needs Attention**: Pulsing amber glow + auto-slide question card.
- 🏷️ **Clear Running & Idle Status on Each Card**:
  - **Running Badge** (`● Running`): Cyan glowing badge with animated pulsing dot when Claude/Antigravity is actively executing tools or thinking (e.g. `Running: Bash`, `Running: Thinking`).
  - **Idle Badge** (`○ Idle`): Emerald badge when the AI is waiting for commands.
  - **Needs Input Badge** (`🔔 Needs Input`): Amber pulsing badge when a question or confirmation is awaiting reply.
  - Quick filter tabs: `All`, `Running`, `Idle`, and `Needs Input`.
- 💬 **Full Markdown Response Viewer**:
  - Click on any session card to drill into the **full AI response**.
  - Complete Markdown formatting: headers, bold/italic, bullet lists, blockquotes, tables.
  - Formatted code blocks with syntax styling and **click-to-copy**.
- 🟢 **Live Running vs. Idle State Engine**:
  - Distinguishes when an AI is actively thinking, executing tools (e.g. `Running: run_command`, `Running: read_file`), analyzing tool results, or idle.
  - Automatically identifies conversation turn lifecycle in Antigravity IDE and Claude Code logs.
  - Real-time status transitions update live inside open cards without manual refresh.
- 💬 **Interactive Conversation Dialog & User Bubbles**:
  - Displays conversation flow with distinct assistant and right-aligned user speech bubbles.
  - When you type and press `Enter` or click `Send`, your message bubble immediately appears in the dialog with timestamp.
- 🖼️ **Image Attachment Support**:
  - Attach images via the **📎 button**, or simply **paste images with `Ctrl+V`** directly into the input area.
  - Supports **drag-and-drop** of image files directly into the window.
  - Displays an attached image preview thumbnail with a quick remove `[✕]` button.
  - User bubble displays the attached image thumbnail (click to expand).
  - Copies both the image and your text directly to the clipboard for instant pasting into Claude or Antigravity!
- ✉️ **1-Click Copy & Switch to Editor**:
  - Type a reply in the overlay and click **`📋 Copy & Switch ↵`** (or press `Enter`).
  - Automatically copies your text to the clipboard and brings Antigravity IDE directly to the foreground.
  - You can immediately paste with `Ctrl + V` into your Claude Code prompt or Antigravity chat with zero risk of stray keystrokes in your code files.
  - Fast-track approval pills: `[✓ Approve / Yes]`, `[✕ Reject / No]`, `[Looks good!]`, `[Explain further]`.
- 🎛️ **Multi-Session & Multi-AI Concurrent Support**:
  - Automatically discovers and tracks multiple active sessions across different projects (`mmo-test`, `hrs-ally-csa`, `het`, etc.).
  - Tracks multiple Claude sessions and Antigravity sessions concurrently.
  - Header displays quick mini-chips for each active AI (`[C: mmo-test]`, `[C: ally-csa]`, `[A: Antigravity]`).
  - Clicking any chip navigates and scrolls directly to that session.
  - Filter tabs in expanded view: `All`, `Needs Input`, `Claude`, `Antigravity`.
  - Individual "Dismiss" buttons per session card.
  - Monitors Claude Code session logs (`~/.claude/projects/`) and Antigravity brain transcripts (`~/.gemini/antigravity/brain/`).

---

## 🚀 Quick Start

### 1. Launch via Batch File
Double-click `start.bat` in this folder.

### 2. Or Launch via Terminal
```bash
npm start
```

---

## 🛠️ Project Structure

- `main.js`: Electron main process controlling the transparent borderless window and tray.
- `preload.js`: Secure context bridge between Electron IPC and the overlay UI.
- `watcher.js`: High-speed tailing scanner for Claude Code and Antigravity logs.
- `ui/index.html`: Clean glassmorphic overlay widget layout.
- `ui/style.css`: Acrylic blur, glow borders, and animations.
- `ui/app.js`: State management, alert triggers, and expand/collapse behaviors.
- `ui/sound.js`: Web Audio API synthesizer for alert chimes.

