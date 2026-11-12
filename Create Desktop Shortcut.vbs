Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcherVbs = appDir & "\Launch AI HUD.vbs"
electronExe = appDir & "\node_modules\electron\dist\electron.exe"
desktopDir = sh.SpecialFolders("Desktop")
shortcutPath = desktopDir & "\AI Overlay HUD.lnk"

Set link = sh.CreateShortcut(shortcutPath)
link.TargetPath = WScript.FullName
link.Arguments = """" & launcherVbs & """"
link.WorkingDirectory = appDir
link.Description = "Multi-AI Session Overlay HUD (Claude Code & Antigravity)"
If fso.FileExists(electronExe) Then
  link.IconLocation = electronExe & ",0"
End If
link.Save

MsgBox "Desktop shortcut created:" & vbCrLf & shortcutPath, vbInformation, "AI Overlay HUD"
