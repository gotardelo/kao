const ELEVENLABS_STT = 'https://api.elevenlabs.io/v1/speech-to-text';

function apiKey(value: unknown) {
  const key = String(value || '').trim();
  if (key.length < 12) throw new Error('Cole uma chave valida da ElevenLabs para usar a voz natural.');
  if (!/^sk_[a-zA-Z0-9_-]+$/.test(key)) throw new Error('A chave da ElevenLabs precisa comecar com sk_. Voce colou o ID da chave, nao a chave real.');
  return key;
}

async function upstreamError(response: Response) {
  const body = await response.json().catch(() => ({})) as { detail?: { message?: string }; error?: { message?: string } };
  const message = body.detail?.message || body.error?.message || response.statusText || 'A transcricao da ElevenLabs falhou.';
  if (/api key id used as api key|only valid api keys|api keys start|invalid api key|unauthori[sz]ed/i.test(message)) {
    return 'A chave da ElevenLabs precisa comecar com sk_. Voce colou o ID da chave, nao a chave real.';
  }
  return message;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const key = apiKey(form.get('apiKey'));
    const audio = form.get('file');
    if (!(audio instanceof File) || !audio.size) throw new Error('Nao recebi um audio para transcrever.');

    const upstreamForm = new FormData();
    upstreamForm.append('file', audio, audio.name || 'fala.webm');
    upstreamForm.append('model_id', 'scribe_v2');
    upstreamForm.append('language_code', 'por');

    const upstream = await fetch(ELEVENLABS_STT, {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: upstreamForm,
      signal: request.signal,
    });
    if (!upstream.ok) return Response.json({ error: { message: await upstreamError(upstream) } }, { status: upstream.status });
    const data = await upstream.json() as { text?: unknown };
    return Response.json({ text: String(data.text || '').trim() }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Nao foi possivel transcrever o audio.' } }, { status: 400 });
  }
}
