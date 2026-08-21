const OPENAI = 'https://api.openai.com/v1';
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

function jsonError(message: string, status = 400) {
  return Response.json({ error: { message } }, { status });
}

function apiKey(value: unknown) {
  const key = String(value || '').trim();
  if (!/^sk-/.test(key)) throw new Error('Chave da OpenAI invalida para abrir a voz ao vivo.');
  return key;
}

function sessionPayload(body: Record<string, unknown>, withTranscription: boolean, withVoice: boolean) {
  const audioInput: Record<string, unknown> = { turn_detection: { type: 'semantic_vad' } };
  if (withTranscription) {
    audioInput.transcription = { model: String(body.transcricao || DEFAULT_TRANSCRIBE_MODEL) };
  }

  const session: Record<string, unknown> = {
    type: 'realtime',
    model: String(body.model || DEFAULT_REALTIME_MODEL),
    instructions: String(body.instructions || '').slice(0, 24000),
    audio: { input: audioInput, output: {} },
  };

  if (withVoice) (session.audio as { output: Record<string, unknown> }).output.voice = String(body.voice || 'marin');
  if (Array.isArray(body.tools) && body.tools.length) {
    session.tools = body.tools;
    session.tool_choice = 'auto';
  }
  return session;
}

async function upstreamJson(response: Response, fallback: string) {
  const text = await response.text().catch(() => '');
  try { return text ? JSON.parse(text) : {}; } catch { return { error: { message: text || fallback } }; }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const key = apiKey(body.apiKey);
    const attempts = [
      sessionPayload(body, body.transcricao !== false, true),
      sessionPayload(body, false, true),
      sessionPayload(body, false, false),
    ];

    let last: { status: number; data: any } | null = null;
    for (let i = 0; i < attempts.length; i++) {
      const upstream = await fetch(`${OPENAI}/realtime/client_secrets`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'OpenAI-Safety-Identifier': String(body.safetyId || 'kao-web-user'),
        },
        body: JSON.stringify({
          session: attempts[i],
          expires_after: { anchor: 'created_at', seconds: 600 },
        }),
        signal: request.signal,
      });
      const data = await upstreamJson(upstream, 'Nao consegui abrir a sessao de voz.');
      if (upstream.ok) {
        const value = String(data.value || data.client_secret?.value || '').trim();
        if (!value) return jsonError('A OpenAI nao devolveu a chave efemera da voz.', 502);
        return Response.json({
          value,
          expiresAt: data.expires_at || 0,
          model: String(body.model || DEFAULT_REALTIME_MODEL),
          semLegenda: i > 0,
          semVoz: i > 1,
        }, { headers: { 'cache-control': 'no-store' } });
      }
      last = { status: upstream.status, data };
      if (upstream.status !== 400) break;
    }

    return Response.json(last?.data || { error: { message: 'Nao consegui abrir a sessao de voz.' } }, { status: last?.status || 502 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Nao foi possivel abrir a voz ao vivo.');
  }
}
