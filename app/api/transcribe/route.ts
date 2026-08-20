const OPENAI_TRANSCRIPTIONS = 'https://api.openai.com/v1/audio/transcriptions';

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const apiKey = String(incoming.get('apiKey') || '').trim();
    const file = incoming.get('file');
    const language = String(incoming.get('language') || 'pt').trim().slice(0, 12);

    if (!/^sk-/.test(apiKey)) {
      return Response.json({ error: { message: 'Salve uma chave OpenAI valida para a escuta neural.' } }, { status: 400 });
    }
    if (!(file instanceof File) || !file.size) {
      return Response.json({ error: { message: 'Nenhum audio foi recebido para transcrever.' } }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return Response.json({ error: { message: 'O audio ficou grande demais. Tente uma frase mais curta.' } }, { status: 413 });
    }

    const payload = new FormData();
    payload.append('model', 'gpt-4o-mini-transcribe');
    payload.append('language', language || 'pt');
    payload.append('file', file, file.name || 'fala.webm');
    const upstream = await fetch(OPENAI_TRANSCRIPTIONS, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: payload,
      signal: request.signal,
    });
    if (!upstream.ok) {
      return Response.json(await upstream.json().catch(() => ({ error: { message: upstream.statusText } })), { status: upstream.status });
    }
    const body = await upstream.json() as { text?: unknown };
    return Response.json({ text: String(body.text || '').trim() });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return Response.json({ error: { message: 'Transcricao cancelada.' } }, { status: 499 });
    }
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Nao foi possivel transcrever o audio.' } }, { status: 500 });
  }
}
