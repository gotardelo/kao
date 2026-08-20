const ELEVENLABS_VOICES = 'https://api.elevenlabs.io/v1/voices';

function apiKey(value: unknown) {
  const key = String(value || '').trim();
  if (key.length < 12) throw new Error('Cole uma chave valida da ElevenLabs.');
  return key;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const upstream = await fetch(ELEVENLABS_VOICES, {
      headers: { 'xi-api-key': apiKey(body.apiKey) },
      signal: request.signal,
    });
    if (!upstream.ok) {
      const data = await upstream.json().catch(() => ({})) as { detail?: { message?: string }; error?: { message?: string } };
      return Response.json({ error: { message: data.detail?.message || data.error?.message || upstream.statusText } }, { status: upstream.status });
    }
    const data = await upstream.json() as { voices?: Array<{ voice_id?: string; name?: string; labels?: Record<string, string> }> };
    return Response.json({
      voices: (data.voices || []).slice(0, 100).map((voice) => ({
        id: String(voice.voice_id || ''),
        name: String(voice.name || ''),
        labels: voice.labels || {},
      })),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Nao foi possivel validar a chave de voz.' } }, { status: 400 });
  }
}
