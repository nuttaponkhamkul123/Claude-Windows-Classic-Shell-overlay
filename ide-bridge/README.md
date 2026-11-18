# AI HUD bridge

A small VS Code / Antigravity IDE extension. When another extension asks you to pick
from a list or type some text (`showQuickPick` / `showInputBox`, the Ctrl+P-style
pop-ups), the question shows in the AI HUD instead, and your answer goes back as if
you had answered in the editor. Example: abap-fs asking which transport request to use.

- Nothing in the other extensions is changed. The bridge starts on IDE startup and
  wraps the editor API for every extension that loads after it.
- With the HUD closed (or `hudBridge.enabled` off) the normal editor pop-up shows.
- Not bridged: custom pickers built with `createQuickPick`, and the IDE's own
  Ctrl+P / command palette.
- Extensions that started before the bridge aren't bridged; run
  **Developer: Reload Window** once. **AI HUD bridge: Show which extensions are
  bridged** lists them.

The HUD side is `main/ipc/ide-pick.js` (local endpoint; port + token in
`~/.ovly-claude/ide-bridge.json`, removed when the HUD quits) and
`ui/logic/system/ide-pick.js` (the picker).

Build and install:

```powershell
powershell -ExecutionPolicy Bypass -File .\ide-bridge\pack.ps1
& "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --install-extension .\ide-bridge\hud-bridge-0.1.0.vsix
```
