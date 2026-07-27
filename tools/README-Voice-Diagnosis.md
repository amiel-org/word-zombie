# Win10 English pronunciation diagnosis

Copy `Diagnose-WordZombieVoice.ps1` to the Windows 10 computer, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\Diagnose-WordZombieVoice.ps1
```

It writes `Word-Zombie-Voice-Diagnosis.txt` to the desktop. The report identifies:

- the Windows version;
- the default HTTP browser handler;
- whether Microsoft Edge is installed;
- installed Windows text-to-speech voices;
- whether an enabled English voice exists;
- installed `Language.TextToSpeech` and `Language.Speech` capabilities when Windows permits the query.

For this game, the system component normally required on Windows 10 is an enabled English **Text-to-speech** voice, preferably `English (United States)`. The game uses the browser Web Speech API; it does not include a separate speech runtime.
