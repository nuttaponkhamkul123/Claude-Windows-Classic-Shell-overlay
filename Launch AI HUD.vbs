Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir

' Ensure Electron runs as a GUI app, not Node CLI
Set procEnv = sh.Environment("PROCESS")
procEnv("ELECTRON_RUN_AS_NODE") = ""

electronExe = appDir & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electronExe) Then
  sh.Run """" & electronExe & """ """ & appDir & """", 0, False
Else
  sh.Run "cmd.exe /c set ELECTRON_RUN_AS_NODE=&& npm start", 0, False
End If
