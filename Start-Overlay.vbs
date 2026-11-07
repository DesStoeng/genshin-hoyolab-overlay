Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Tawan\.gemini\antigravity\scratch\genshin-hoyolab-overlay"
WshShell.Run "cmd.exe /c ""C:\Users\Tawan\.gemini\antigravity\scratch\genshin-hoyolab-overlay\Start-Overlay.bat""", 0, False
Set WshShell = Nothing
