import sys
from pathlib import Path

import soundfile as sf
from kokoro import KPipeline


text = sys.stdin.read().strip()
if not text:
    raise SystemExit(0)

out = Path.home() / "AppData" / "Local" / "Temp" / "jarvis-0.wav"
pipe = KPipeline(lang_code="p")

for _, _, audio in pipe(text, voice="pf_dora", speed=1):
    sf.write(out, audio, 24000)
    print(out)
    break
