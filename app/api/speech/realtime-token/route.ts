import { resolverChave } from '../chave';
const ELEVENLABS_TOKEN = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';

async function upstreamError(response: Response) {
  const body = await response.json().catch(() => ({})) as { detail?: { message?: string }; error?: { message?: string } };
  const message = body.detail?.message || body.error?.message || response.statusText || 'Nao foi possivel abrir a transcricao em tempo real.';
  if (/api key id used as api key|only valid api keys|api keys start|invalid api key|unauthori[sz]ed/i.test(message)) {
    return 'A chave da ElevenLabs precisa comecar com sk_. Voce colou o ID da chave, nao a chave real.';
  }
  return message;
}

/** Gera um token efemero para o WebSocket do Scribe sem expor a chave no socket. */
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const upstream = await fetch(ELEVENLABS_TOKEN, {
      method: 'POST',
      headers: { 'xi-api-key': resolverChave(body.apiKey, 'para usar a voz natural') },
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
