import os
import sys

from elevenlabs.client import ElevenLabs
from elevenlabs.play import play


text = sys.stdin.read().strip()
if not text:
    raise SystemExit(0)

client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
audio = client.text_to_speech.convert(
    text=text,
    voice_id=os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb"),
    model_id="eleven_multilingual_v2",
    output_format="mp3_44100_128",
)
play(audio)
