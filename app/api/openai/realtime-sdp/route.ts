const OPENAI = 'https://api.openai.com/v1';

function jsonError(message: string, status = 400) {
  return Response.json({ error: { message } }, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const ephemeralKey = String(body.ephemeralKey || '').trim();
    const sdp = String(body.sdp || '');
    if (!/^ek_/.test(ephemeralKey)) return jsonError('Sessao de voz sem chave efemera valida.');
    if (!sdp) return jsonError('Oferta SDP vazia.');

    const upstream = await fetch(`${OPENAI}/realtime/calls`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ephemeralKey}`,
        'content-type': 'application/sdp',
      },
      body: sdp,
      signal: request.signal,
    });

    const text = await upstream.text().catch(() => '');
    if (!upstream.ok) {
      try { return Response.json(JSON.parse(text), { status: upstream.status }); }
      catch {
        return jsonError(text || `A OpenAI recusou a sessao de voz (HTTP ${upstream.status}).`, upstream.status);
      }
    }

    return new Response(text, {
      headers: { 'content-type': 'application/sdp', 'cache-control': 'no-cache' },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Nao foi possivel trocar o SDP da voz.');
  }
}
