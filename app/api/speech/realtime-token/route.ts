const ELEVENLABS_TOKEN = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';

function apiKey(value: unknown) {
  const key = String(value || '').trim();
  if (key.length < 12) throw new Error('Cole uma chave valida da ElevenLabs para usar a voz natural.');
  return key;
}

async function upstreamError(response: Response) {
  const body = await response.json().catch(() => ({})) as { detail?: { message?: string }; error?: { message?: string } };
  return body.detail?.message || body.error?.message || response.statusText || 'Nao foi possivel abrir a transcricao em tempo real.';
}

/** Gera um token efemero para o WebSocket do Scribe sem expor a chave no socket. */
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const upstream = await fetch(ELEVENLABS_TOKEN, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey(body.apiKey) },
      signal: request.signal,
    });
    if (!upstream.ok) return Response.json({ error: { message: await upstreamError(upstream) } }, { status: upstream.status });

    const data = await upstream.json() as { token?: unknown };
    const token = String(data.token || '').trim();
    if (!token) throw new Error('A ElevenLabs nao devolveu o token da transcricao em tempo real.');
    return Response.json({ token }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Nao foi possivel abrir a transcricao em tempo real.' } }, { status: 400 });
  }
}
