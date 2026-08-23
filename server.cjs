/* ============================================================
   TDAHZEI - servidor local + proxy OpenAI
   Uso:  node server.js  [porta]
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 5173;
const OPENAI = 'https://api.openai.com/v1';
const ANTHROPIC = 'https://api.anthropic.com/v1';
const ELEVEN = 'https://api.elevenlabs.io/v1';
const REALTIME_MODEL = process.env.KAO_REALTIME_MODEL || 'gpt-realtime-2.1';
const TRANSCRIBE_MODEL = process.env.KAO_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache'
  });
  res.end(JSON.stringify(body));
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(Object.assign(new Error('Payload grande demais.'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(Object.assign(new Error('JSON invalido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/** Corpo cru — a transcricao chega como multipart e nao da para ler como JSON. */
function readRaw(req, maxBytes = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Arquivo grande demais.'), { status: 413 }));
        req.destroy();
        return;
      }
      partes.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

const FORMATO_ELEVEN = /^sk_[a-zA-Z0-9_-]+$/;

/* Mesma regra do deploy: usa a chave que o navegador mandou e, se nao veio
   nenhuma, cai na do ambiente. Assim quem exporta ELEVENLABS_API_KEY nao
   precisa colar nada em aparelho nenhum. */
function chaveElevenLabs(valor, contexto = 'para usar a voz natural') {
  const key = String(valor || '').trim();
  if (!key) {
    const doAmbiente = String(process.env.ELEVENLABS_API_KEY || '').trim();
    if (FORMATO_ELEVEN.test(doAmbiente)) return doAmbiente;
    throw Object.assign(new Error('Cole uma chave valida da ElevenLabs ' + contexto + '.'), { status: 400 });
  }
  if (!FORMATO_ELEVEN.test(key)) {
    throw Object.assign(
      new Error('A chave da ElevenLabs precisa comecar com sk_. Voce colou o ID da chave, nao a chave real.'),
      { status: 400 }
    );
  }
  return key;
}

function mensagemDaEleven(texto, status) {
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch (_) {}
  const msg = (corpo && ((corpo.detail && corpo.detail.message) || (corpo.error && corpo.error.message))) ||
              texto || `A ElevenLabs recusou a chamada (HTTP ${status}).`;
  if (/api key id used as api key|only valid api keys|api keys start|invalid api key|unauthori[sz]ed/i.test(msg)) {
    return 'A chave da ElevenLabs precisa comecar com sk_. Voce colou o ID da chave, nao a chave real.';
  }
  return msg;
}

/* --------------------------------------------------------
   Conversao OpenAI -> Anthropic

   O app fala sempre no formato da OpenAI. Quando o modelo escolhido e um
   Claude, a traducao acontece aqui — igual a que roda no deploy, so que sem
   dependencia nenhuma para este servidor continuar sendo um arquivo so.
   -------------------------------------------------------- */
function mensagensAnthropic(messages) {
  let system = '';
  const saida = [];
  for (const m of messages || []) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + String(m.content || '');
      continue;
    }
    if (m.role === 'tool') {
      const bloco = { type: 'tool_result', tool_use_id: String(m.tool_call_id || ''), content: String(m.content || '') };
      const anterior = saida[saida.length - 1];
      if (anterior && anterior.role === 'user' && Array.isArray(anterior.content)) anterior.content.push(bloco);
      else saida.push({ role: 'user', content: [bloco] });
      continue;
    }
    if (m.role === 'assistant') {
      const blocos = [];
      if (m.content) blocos.push({ type: 'text', text: String(m.content) });
      for (const call of m.tool_calls || []) {
        let input = {};
        try { input = JSON.parse((call.function && call.function.arguments) || '{}'); } catch (_) {}
        blocos.push({ type: 'tool_use', id: call.id, name: call.function && call.function.name, input: input });
      }
      saida.push({ role: 'assistant', content: blocos });
      continue;
    }
    saida.push({ role: 'user', content: String(m.content || '') });
  }
  return { system, messages: saida };
}

function payloadAnthropic(payload) {
  const convertido = mensagensAnthropic(Array.isArray(payload.messages) ? payload.messages : []);
  const tools = Array.isArray(payload.tools)
    ? payload.tools.map((t) => ({
        name: t.function && t.function.name,
        description: (t.function && t.function.description) || '',
        input_schema: (t.function && t.function.parameters) || { type: 'object', properties: {} }
      }))
    : null;
  return {
    model: String(payload.model || 'claude-sonnet-4-5'),
    max_tokens: Math.min(Math.max(Number(payload.max_completion_tokens) || 4000, 1), 64000),
    stream: payload.stream !== false,
    system: convertido.system || undefined,
    messages: convertido.messages,
    tools: tools && tools.length ? tools : undefined,
    tool_choice: tools && tools.length ? { type: 'auto' } : undefined
  };
}

/** Repassa o corpo do upstream em pedacos, para o streaming nao virar bloco. */
async function repassarFluxo(res, upstream, contentType) {
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (_) {
    if (!res.destroyed) res.end();
  }
}

function apiKeyFrom(body) {
  const key = String(body.apiKey || '').trim();
  if (!/^sk-/.test(key)) {
    throw Object.assign(new Error('Cole uma chave da OpenAI valida, iniciando com sk-.'), { status: 400 });
  }
  return key;
}

async function openaiFetch(res, url, apiKey, init) {
  const upstream = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(init && init.headers ? init.headers : {})
    }
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) {}
    sendJson(res, upstream.status, body || { error: { message: text || `Erro HTTP ${upstream.status}` } });
    return null;
  }
  return upstream;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'kao-openai-proxy' });
  }

  if (pathname === '/api/openai/test' && req.method === 'POST') {
    const body = await readJson(req, 64 * 1024);
    const apiKey = apiKeyFrom(body);
    const upstream = await openaiFetch(res, `${OPENAI}/models`, apiKey, { method: 'GET' });
    if (!upstream) return;
    const data = await upstream.json();
    return sendJson(res, 200, { ok: true, count: Array.isArray(data.data) ? data.data.length : 0 });
  }

  /* --------------------------------------------------------
     ROTAS QUE O APP REALMENTE CHAMA

     O front usa /api/chat, /api/test e /api/speech/*. Elas existiam so no
     deploy (app/api), entao quem rodava "node server.js" ficava sem chat e
     sem voz — 404 em tudo. Agora os dois caminhos servem a mesma coisa.
     -------------------------------------------------------- */
  if (pathname === '/api/test' && req.method === 'POST') {
    const body = await readJson(req, 64 * 1024);
    const provider = body.provider === 'anthropic' ? 'anthropic' : 'openai';
    const key = String(body.apiKey || '').trim();
    const formato = provider === 'anthropic' ? /^sk-ant-/ : /^sk-/;
    if (!formato.test(key)) {
      return sendJson(res, 400, { error: { message: provider === 'anthropic'
        ? 'Cole uma chave da Anthropic valida, iniciando com sk-ant-.'
        : 'Cole uma chave da OpenAI valida, iniciando com sk-.' } });
    }
    const upstream = await fetch(provider === 'anthropic' ? `${ANTHROPIC}/models` : `${OPENAI}/models`, {
      headers: provider === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : { authorization: `Bearer ${key}` }
    });
    if (!upstream.ok) {
      const texto = await upstream.text().catch(() => '');
      let parsed = null;
      try { parsed = texto ? JSON.parse(texto) : null; } catch (_) {}
      return sendJson(res, upstream.status, parsed || { error: { message: texto || `Erro HTTP ${upstream.status}` } });
    }
    return sendJson(res, 200, { ok: true, provider: provider });
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    const body = await readJson(req, 8 * 1024 * 1024);
    const provider = body.provider === 'anthropic' ? 'anthropic' : 'openai';
    const key = String(body.apiKey || '').trim();
    const formato = provider === 'anthropic' ? /^sk-ant-/ : /^sk-/;
    if (!formato.test(key)) {
      return sendJson(res, 400, { error: { message: provider === 'anthropic'
        ? 'Chave da Anthropic invalida.' : 'Chave da OpenAI invalida.' } });
    }
    const payload = body.payload || {};
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const upstream = await fetch(provider === 'anthropic' ? `${ANTHROPIC}/messages` : `${OPENAI}/chat/completions`, {
      method: 'POST',
      headers: provider === 'anthropic'
        ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(provider === 'anthropic' ? payloadAnthropic(payload) : payload),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const texto = await upstream.text().catch(() => '');
      let parsed = null;
      try { parsed = texto ? JSON.parse(texto) : null; } catch (_) {}
      return sendJson(res, upstream.status, parsed || { error: { message: texto || `Erro HTTP ${upstream.status}` } });
    }

    return repassarFluxo(res, upstream, payload.stream === false
      ? 'application/json; charset=utf-8'
      : 'text/event-stream; charset=utf-8');
  }

  /* --------------------------------------------------------
     VOZ NATURAL (ElevenLabs)
     -------------------------------------------------------- */
  if (pathname === '/api/speech/status' && req.method === 'GET') {
    const doAmbiente = String(process.env.ELEVENLABS_API_KEY || '').trim();
    return sendJson(res, 200, { serverKey: FORMATO_ELEVEN.test(doAmbiente) });
  }

  if (pathname === '/api/speech/voices' && req.method === 'POST') {
    const body = await readJson(req, 64 * 1024);
    const key = chaveElevenLabs(body.apiKey, 'para listar as vozes');
    const upstream = await fetch(`${ELEVEN}/voices`, { headers: { 'xi-api-key': key } });
    const texto = await upstream.text().catch(() => '');
    if (!upstream.ok) {
      return sendJson(res, upstream.status, { error: { message: mensagemDaEleven(texto, upstream.status) } });
    }
    let data = {};
    try { data = texto ? JSON.parse(texto) : {}; } catch (_) {}
    return sendJson(res, 200, {
      voices: (data.voices || []).slice(0, 100).map((v) => ({
        id: String(v.voice_id || ''), name: String(v.name || ''), labels: v.labels || {}
      }))
    });
  }

  if (pathname === '/api/speech/realtime-token' && req.method === 'POST') {
    const body = await readJson(req, 64 * 1024);
    const key = chaveElevenLabs(body.apiKey);
    const upstream = await fetch(`${ELEVEN}/single-use-token/realtime_scribe`, {
      method: 'POST',
      headers: { 'xi-api-key': key }
    });
    const texto = await upstream.text().catch(() => '');
    if (!upstream.ok) {
      return sendJson(res, upstream.status, { error: { message: mensagemDaEleven(texto, upstream.status) } });
    }
    let data = {};
    try { data = texto ? JSON.parse(texto) : {}; } catch (_) {}
    const token = String(data.token || '').trim();
    if (!token) {
      return sendJson(res, 502, { error: { message: 'A ElevenLabs nao devolveu o token da transcricao em tempo real.' } });
    }
    return sendJson(res, 200, { token: token });
  }

  if (pathname === '/api/speech/synthesize' && req.method === 'POST') {
    const body = await readJson(req, 1024 * 1024);
    const key = chaveElevenLabs(body.apiKey);
    const texto = String(body.text || '').trim().slice(0, 5000);
    if (!texto) {
      return sendJson(res, 400, { error: { message: 'Nao ha texto para falar.' } });
    }
    const voiceId = String(body.voiceId || 'JBFqnCBsd6RMkjVDRZzb').trim();
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(voiceId)) {
      return sendJson(res, 400, { error: { message: 'O ID da voz natural e invalido.' } });
    }
    const modelos = ['eleven_turbo_v2_5', 'eleven_multilingual_v2', 'eleven_flash_v2_5'];
    const modelo = String(body.modelId || 'eleven_multilingual_v2').trim();
    if (modelos.indexOf(modelo) < 0) {
      return sendJson(res, 400, { error: { message: 'Esse modelo de voz nao e suportado pelo TDAHZEI.' } });
    }
    const cfg = (body.voiceSettings && typeof body.voiceSettings === 'object') ? body.voiceSettings : {};
    const num = (v, padrao, min, max) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao;
    };

    const upstream = await fetch(`${ELEVEN}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': key },
      body: JSON.stringify({
        text: texto,
        model_id: modelo,
        apply_text_normalization: 'auto',
        voice_settings: {
          stability: num(cfg.stability, 0.48, 0, 1),
          similarity_boost: num(cfg.similarityBoost != null ? cfg.similarityBoost : cfg.similarity_boost, 0.75, 0, 1),
          style: num(cfg.style, 0.12, 0, 1),
          use_speaker_boost: typeof cfg.speakerBoost === 'boolean' ? cfg.speakerBoost : true,
          speed: num(cfg.speed, 1, 0.7, 1.2)
        }
      })
    });

    if (!upstream.ok) {
      const erro = await upstream.text().catch(() => '');
      return sendJson(res, upstream.status, { error: { message: mensagemDaEleven(erro, upstream.status) } });
    }
    return repassarFluxo(res, upstream, upstream.headers.get('content-type') || 'audio/mpeg');
  }

  if (pathname === '/api/speech/transcribe' && req.method === 'POST') {
    const bruto = await readRaw(req);
    const form = await new Response(bruto, {
      headers: { 'content-type': req.headers['content-type'] || 'application/octet-stream' }
    }).formData().catch(() => null);
    if (!form) {
      return sendJson(res, 400, { error: { message: 'Nao recebi um audio para transcrever.' } });
    }
    const key = chaveElevenLabs(form.get('apiKey'));
    const audio = form.get('file');
    if (!audio || typeof audio === 'string' || !audio.size) {
      return sendJson(res, 400, { error: { message: 'Nao recebi um audio para transcrever.' } });
    }

    const envio = new FormData();
    envio.append('file', audio, audio.name || 'fala.webm');
    envio.append('model_id', 'scribe_v2');
    envio.append('language_code', 'por');

    const upstream = await fetch(`${ELEVEN}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: envio
    });
    const texto = await upstream.text().catch(() => '');
    if (!upstream.ok) {
      return sendJson(res, upstream.status, { error: { message: mensagemDaEleven(texto, upstream.status) } });
    }
    let data = {};
    try { data = texto ? JSON.parse(texto) : {}; } catch (_) {}
    return sendJson(res, 200, { text: String(data.text || '').trim() });
  }

  /* Conta e sincronizacao vivem no banco do deploy; aqui nao ha banco.
     Melhor dizer isso em portugues do que devolver um 404 seco. */
  if (pathname === '/api/sync') {
    return sendJson(res, 501, {
      error: {
        code: 'SYNC_INDISPONIVEL',
        message: 'Este servidor local nao guarda contas. Use os dados que ja estao neste ' +
                 'navegador, ou rode "npm run dev" para criar conta e sincronizar entre aparelhos.'
      }
    });
  }

  if (pathname === '/api/openai/chat' && req.method === 'POST') {
    const body = await readJson(req, 4 * 1024 * 1024);
    const apiKey = apiKeyFrom(body);
    const payload = body.payload || {};
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const upstream = await openaiFetch(res, `${OPENAI}/chat/completions`, apiKey, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!upstream) return;

    res.writeHead(200, {
      'content-type': payload.stream === false ? 'application/json; charset=utf-8' : 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });

    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err) {
      if (!res.destroyed) res.end();
    }
    return;
  }

  /* --------------------------------------------------------
     VOZ AO VIVO (Realtime API)
     1) /realtime-token  -> chave efemera (ek_...) valida por poucos minutos
     2) /realtime-sdp    -> troca de SDP com a ek_ (evita CORS no navegador)
     -------------------------------------------------------- */
  if (pathname === '/api/openai/realtime-token' && req.method === 'POST') {
    const body = await readJson(req, 512 * 1024);
    const apiKey = apiKeyFrom(body);
    const model = String(body.model || REALTIME_MODEL);

    function montarSessao(comTranscricao, comVoz) {
      const audioInput = { turn_detection: { type: 'semantic_vad' } };
      if (comTranscricao) {
        audioInput.transcription = { model: String(body.transcricao || TRANSCRIBE_MODEL) };
      }
      const s = {
        type: 'realtime',
        model: model,
        instructions: String(body.instructions || '').slice(0, 24000),
        audio: { input: audioInput, output: {} }
      };
      if (comVoz) s.audio.output.voice = String(body.voice || 'marin');
      if (Array.isArray(body.tools) && body.tools.length) {
        s.tools = body.tools;
        s.tool_choice = 'auto';
      }
      return s;
    }

    /* A conta pode nao ter o modelo de transcricao ou a voz escolhida.
       Perder a legenda e melhor do que a voz nao abrir, entao tentamos
       de novo tirando um extra por vez antes de desistir. */
    const tentativas = [
      montarSessao(body.transcricao !== false, true),
      montarSessao(false, true),
      montarSessao(false, false)
    ];

    let ultimo = null;
    for (let i = 0; i < tentativas.length; i++) {
      const r = await fetch(`${OPENAI}/realtime/client_secrets`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'OpenAI-Safety-Identifier': body.safetyId || 'kao-local-user'
        },
        body: JSON.stringify({ session: tentativas[i], expires_after: { anchor: 'created_at', seconds: 600 } })
      });

      const texto = await r.text().catch(() => '');
      if (r.ok) {
        let data = {};
        try { data = texto ? JSON.parse(texto) : {}; } catch (_) {}
        const value = data.value || (data.client_secret && data.client_secret.value) || '';
        if (!value) {
          return sendJson(res, 502, { error: { message: 'A OpenAI nao devolveu a chave efemera da sessao de voz.' } });
        }
        return sendJson(res, 200, {
          value: value,
          expiresAt: data.expires_at || 0,
          model: model,
          semLegenda: i > 0,
          semVoz: i > 1
        });
      }

      let parsed = null;
      try { parsed = texto ? JSON.parse(texto) : null; } catch (_) {}
      ultimo = { status: r.status, body: parsed, texto: texto };
      if (r.status !== 400) break;             // 401/403/404 nao melhoram tentando de novo
    }

    return sendJson(res, (ultimo && ultimo.status) || 502, (ultimo && ultimo.body) || {
      error: { message: (ultimo && ultimo.texto) || 'Nao consegui abrir a sessao de voz.' }
    });
  }

  if (pathname === '/api/openai/realtime-sdp' && req.method === 'POST') {
    const body = await readJson(req, 1024 * 1024);
    const ek = String(body.ephemeralKey || '').trim();
    const sdp = String(body.sdp || '');
    if (!/^ek_/.test(ek)) {
      throw Object.assign(new Error('Sessao de voz sem chave efemera valida.'), { status: 400 });
    }
    if (!sdp) {
      throw Object.assign(new Error('Oferta SDP vazia.'), { status: 400 });
    }

    // Sem ?model=: a sessao ja esta amarrada na chave efemera.
    const url = `${OPENAI}/realtime/calls`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ek}`,
        'content-type': 'application/sdp'
      },
      body: sdp
    });

    const texto = await upstream.text().catch(() => '');
    if (!upstream.ok) {
      let parsed = null;
      try { parsed = JSON.parse(texto); } catch (_) {}
      return sendJson(res, upstream.status, parsed || {
        error: { message: texto || `A OpenAI recusou a sessao de voz (HTTP ${upstream.status}).` }
      });
    }

    res.writeHead(200, { 'content-type': 'application/sdp', 'cache-control': 'no-cache' });
    res.end(texto);
    return;
  }

  sendJson(res, 404, { error: { message: 'Rota de API nao encontrada.' } });
}

function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/') rel = '/index.html';

  let file;
  try {
    const safeRel = path.normalize(rel).replace(/^([/\\])+/, '');
    file = path.resolve(ROOT, safeRel);
  } catch (_) {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 - nao encontrado');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    }).end(data);
  });
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  } catch (_) {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      if (res.headersSent || res.destroyed) return;
      sendJson(res, err.status || 500, { error: { message: err.message || 'Erro interno.' } });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

function lanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.log('');
  console.log('  TDAHZEI rodando');
  console.log('  --------------------------------------------');
  console.log('  Desktop:  http://localhost:' + PORT);
  if (ip) console.log('  Celular:  http://' + ip + ':' + PORT + '   (mesma rede Wi-Fi)');
  console.log('');
  console.log('  Chat:         /api/chat  /api/test');
  console.log('  Voz natural:  /api/speech/synthesize  /api/speech/transcribe  /api/speech/voices');
  console.log('  Voz ao vivo:  /api/openai/realtime-token  /api/openai/realtime-sdp  (' + REALTIME_MODEL + ')');
  console.log('  Voz no navegador precisa de permissao de microfone e funciona melhor em localhost/HTTPS.');
  console.log('');
});
