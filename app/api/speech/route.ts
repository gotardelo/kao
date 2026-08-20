const OPENAI_SPEECH = 'https://api.openai.com/v1/audio/speech';

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const apiKey = String(body.apiKey || '').trim();
    const input = String(body.input || '').trim().slice(0, 4096);
    if (!/^sk-/.test(apiKey)) {
      return Response.json({ error: { message: 'Chave da OpenAI invalida para a voz neural.' } }, { status: 400 });
    }
    if (!input) return Response.json({ error: { message: 'Texto de fala vazio.' } }, { status: 400 });
    const upstream = await fetch(OPENAI_SPEECH, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: String(body.voice || 'marin'),
        input,
        instructions: 'Fale em portugues do Brasil, com calor humano, ritmo calmo e natural. Soe como um coach presente e confiavel, nunca como um robô.',
        response_format: 'mp3',
      }),
      signal: request.signal,
    });
    if (!upstream.ok) {
      return Response.json(await upstream.json().catch(() => ({ error: { message: upstream.statusText } })), { status: upstream.status });
    }
    return new Response(upstream.body, {
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Nao foi possivel gerar a voz.' } }, { status: 500 });
  }
}
