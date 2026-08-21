# JarvisOS local

Este kit aplica o PDF no projeto:

- Claude Code como cerebro, usando as skills em `.claude/skills/`.
- Vault markdown em `~/Vault`, com `00-Inbox`, `Diario`, `contexto.md`, `pendencias.md` e `.claudeignore`.
- `whisper.cpp` como ouvido local/offline, usando `ggml-base.bin` sem `.en` e `-l pt`.
- Voz por SAPI no Windows, Kokoro local opcional ou ElevenLabs em producao.
- Loop `jarvis.ps1`: grava, transcreve, chama `claude -p --add-dir ~/Vault` e fala a resposta.

## Estado desta maquina

Instalado agora:

- Poppler / `pdftotext` via Winget.
- `whisper-cli.exe` em `~/tools/whisper.cpp/Release/whisper-cli.exe`.
- Modelo `ggml-base.bin` em `~/models/ggml-base.bin`.
- Claude Code CLI `2.1.238`.
- Biblioteca Python `elevenlabs` para voz natural quando `ELEVENLABS_API_KEY` estiver no ambiente.
- Python 3.12 isolado em `~/tools/jarvisos-kokoro` com Kokoro para voz offline.

Ainda depende de voce ter o Claude Code CLI autenticado no terminal:

```powershell
claude --version
```

## Rodar

Crie/atualize o vault:

```powershell
powershell -ExecutionPolicy Bypass -File .\jarvisos\scripts\setup-vault.ps1
```

Liste os microfones do Windows pelo FFmpeg:

```powershell
ffmpeg -list_devices true -f dshow -i dummy
```

Rode o loop:

```powershell
powershell -ExecutionPolicy Bypass -File .\jarvisos\scripts\jarvis.ps1 -Mic "NOME DO MICROFONE"
```

Escolha a boca:

```powershell
powershell -ExecutionPolicy Bypass -File .\jarvisos\scripts\jarvis.ps1 -Mic "NOME DO MICROFONE" -VoiceBackend windows

$env:ELEVENLABS_API_KEY="sua_chave"
powershell -ExecutionPolicy Bypass -File .\jarvisos\scripts\jarvis.ps1 -Mic "NOME DO MICROFONE" -VoiceBackend elevenlabs -ElevenVoiceId "ID_DA_VOZ"

powershell -ExecutionPolicy Bypass -File .\jarvisos\scripts\jarvis.ps1 -Mic "NOME DO MICROFONE" -VoiceBackend kokoro
```

Rodar a caixa sem voz:

```powershell
powershell -ExecutionPolicy Bypass -File .\jarvisos\scripts\caixa.ps1
```

## Armadilha importante

Nao use modelo `.en` para portugues. Ele tende a traduzir para ingles em vez de transcrever.
Use `ggml-base.bin`, `ggml-small.bin`, `ggml-medium.bin` ou `ggml-large-v3-turbo.bin`, sempre com `-l pt`.
