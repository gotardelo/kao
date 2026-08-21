import os
import sys
from pathlib import Path

try:
    import soundfile as sf
    from kokoro import KPipeline
except Exception as exc:
    raise SystemExit(
        "Kokoro local indisponivel. Instale em Python compativel e tente novamente: "
        f"{exc}"
    )


text = sys.stdin.read().strip()
if not text:
    raise SystemExit(0)

out = Path.home() / "AppData" / "Local" / "Temp" / "jarvis-0.wav"
pipe = KPipeline(lang_code=os.environ.get("KOKORO_LANG", "p"))
voice = os.environ.get("KOKORO_VOICE", "pf_dora")
speed = float(os.environ.get("KOKORO_SPEED", "1"))

for _, _, audio in pipe(text, voice=voice, speed=speed):
    sf.write(out, audio, 24000)
    print(out)
    break
