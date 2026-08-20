const OPENAI = 'https://api.openai.com/v1/models';
const ANTHROPIC = 'https://api.anthropic.com/v1/models';

function apiKey(body: Record<string, unknown>, provider: string) {
  const key = String(body.apiKey || '').trim();
  const valid = provider === 'anthropic' ? /^sk-ant-/ : /^sk-/;
  if (!valid.test(key)) {
    throw new Error(provider === 'anthropic'
      ? 'Cole uma chave da Anthropic valida, iniciando com sk-ant-.'
      : 'Cole uma chave da OpenAI valida, iniciando com sk-.');
  }
  return key;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const provider = body.provider === 'anthropic' ? 'anthropic' : 'openai';
    const key = apiKey(body, provider);
    const upstream = await fetch(provider === 'anthropic' ? ANTHROPIC : OPENAI, {
      headers: provider === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : { authorization: `Bearer ${key}` },
    });
    if (!upstream.ok) return Response.json(await upstream.json().catch(() => ({ error: { message: upstream.statusText } })), { status: upstream.status });
    return Response.json({ ok: true, provider });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Requisicao invalida.' } }, { status: 400 });
  }
}
