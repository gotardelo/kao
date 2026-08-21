const ELEVENLABS_TTS = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';
const DEFAULT_MODEL = 'eleven_turbo_v2_5';
const SUPPORTED_MODELS = new Set([
  'eleven_turbo_v2_5',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
]);

function apiKey(value: unknown) {
  const key = String(value || '').trim();
  if (key.length < 12) throw new Error('Cole uma chave valida da ElevenLabs para usar a voz natural.');
  return key;
}

function modelId(value: unknown) {
  const model = String(value || DEFAULT_MODEL).trim();
  if (!SUPPORTED_MODELS.has(model)) throw new Error('Esse modelo de voz nao e suportado pelo TDAHZEI.');
  return model;
}

function numericSetting(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function booleanSetting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function voiceSettings(value: unknown) {
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    stability: numericSetting(src.stability, 0.48, 0, 1),
    similarity_boost: numericSetting(src.similarityBoost ?? src.similarity_boost, 0.75, 0, 1),
    style: numericSetting(src.style, 0.12, 0, 1),
    use_speaker_boost: booleanSetting(src.speakerBoost ?? src.use_speaker_boost, true),
    speed: numericSetting(src.speed, 1, 0.7, 1.2),
  };
}

async function upstreamError(response: Response) {
  const body = await response.json().catch(() => ({})) as { detail?: { message?: string }; error?: { message?: string } };
  return body.detail?.message || body.error?.message || response.statusText || 'A sintese da ElevenLabs falhou.';
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const key = apiKey(body.apiKey);
    const text = String(body.text || '').trim().slice(0, 5000);
    if (!text) throw new Error('Nao ha texto para falar.');

    const voiceId = String(body.voiceId || DEFAULT_VOICE).trim();
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(voiceId)) throw new Error('O ID da voz natural e invalido.');
    const model = modelId(body.modelId);

    const endpoint = new URL(ELEVENLABS_TTS + '/' + encodeURIComponent(voiceId) + '/stream');
    endpoint.searchParams.set('output_format', 'mp3_44100_128');

    const payload: Record<string, unknown> = {
      text,
      model_id: model,
      voice_settings: voiceSettings(body.voiceSettings),
      apply_text_normalization: 'auto',
    };

    // Multilingual v2 detects Portuguese from the text and does not accept language_code.
    if (model !== 'eleven_multilingual_v2') payload.language_code = 'pt';

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': key },
      body: JSON.stringify(payload),
      signal: request.signal,
    });
    if (!upstream.ok) return Response.json({ error: { message: await upstreamError(upstream) } }, { status: upstream.status });

    return new Response(upstream.body, {
      headers: { 'content-type': upstream.headers.get('content-type') || 'audio/mpeg', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Nao foi possivel gerar a fala.' } }, { status: 400 });
  }
}
