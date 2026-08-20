/* ============================================================
   Kao — cliente da API Anthropic (fetch + SSE, direto do navegador)

   O navegador só consegue chamar api.anthropic.com quando o header
   'anthropic-dangerous-direct-browser-access' está presente — é o
   opt-in oficial de CORS. Isso significa que a chave fica no
   dispositivo do usuário: ótimo para uso pessoal, inadequado para
   uma chave compartilhada entre várias pessoas.
   ============================================================ */
(function (global) {
  'use strict';

  var ENDPOINT = 'https://api.anthropic.com/v1/messages';
  var MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models';
  var VERSION = '2023-06-01';

  /* ---------- catálogo (preços em US$ por 1M de tokens) ---------- */
  var MODELS = [
    {
      id: 'claude-opus-5',
      name: 'Claude Opus 5',
      tag: 'Recomendado',
      desc: 'O melhor equilíbrio entre inteligência e custo. Raciocínio adaptativo ligado por padrão.',
      ctx: 1000000, maxOut: 128000,
      price: { in: 5, out: 25 },
      effort: true, thinking: 'adaptive', fallbacks: true
    },
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      tag: 'Rápido',
      desc: 'Muito capaz e mais barato. Ótimo para o dia a dia e respostas longas.',
      ctx: 1000000, maxOut: 128000,
      price: { in: 3, out: 15 },
      effort: true, thinking: 'adaptive', fallbacks: false
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      tag: 'Econômico',
      desc: 'O mais barato e rápido. Bom para tarefas simples e alto volume.',
      ctx: 200000, maxOut: 64000,
      price: { in: 1, out: 5 },
      effort: false, thinking: 'budget', fallbacks: false
    },
    {
      id: 'claude-fable-5',
      name: 'Claude Fable 5',
      tag: 'Máximo',
      desc: 'O modelo mais capaz da Anthropic, para trabalho difícil e longo. Custa bem mais.',
      ctx: 1000000, maxOut: 128000,
      price: { in: 10, out: 50 },
      effort: true, thinking: 'always', fallbacks: true
    }
  ];

  function modelOf(id) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i];
    return MODELS[0];
  }

  /* ---------- erros com mensagem amigável ---------- */
  function ApiError(message, kind, status) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.kind = kind || 'unknown';
    e.status = status || 0;
    return e;
  }

  function describe(status, body) {
    var type = (body && body.error && body.error.type) || '';
    var msg = (body && body.error && body.error.message) || '';
    switch (status) {
      case 400:
        return ApiError('Requisição inválida: ' + (msg || 'verifique o modelo e as opções.'), 'invalid_request', 400);
      case 401:
        return ApiError('Chave da API inválida ou revogada. Confira em Chave & Modelo.', 'auth', 401);
      case 403:
        return ApiError('Sua chave não tem permissão para esse modelo.', 'permission', 403);
      case 404:
        return ApiError('Modelo não encontrado para esta conta.', 'not_found', 404);
      case 413:
        return ApiError('A conversa ficou grande demais para uma requisição.', 'too_large', 413);
      case 429:
        return ApiError('Limite de uso atingido. Aguarde alguns segundos e tente de novo.', 'rate_limit', 429);
      case 500: case 502: case 503:
        return ApiError('A API da Anthropic teve um erro temporário. Tente novamente.', 'server', status);
      case 529:
        return ApiError('A API está sobrecarregada no momento. Tente em instantes.', 'overloaded', 529);
      default:
        return ApiError(msg || ('Erro inesperado (HTTP ' + status + ').'), type || 'unknown', status);
    }
  }

  function headers(apiKey, betas) {
    var h = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (betas && betas.length) h['anthropic-beta'] = betas.join(',');
    return h;
  }

  /**
   * Monta o corpo da requisição respeitando as capacidades de cada modelo.
   * Regras importantes da API atual:
   *  - temperature/top_p foram removidos nos modelos 4.6+ (enviar → HTTP 400).
   *  - budget_tokens só existe em modelos antigos (Haiku 4.5); nos novos usa-se
   *    thinking adaptativo + output_config.effort.
   *  - nunca desligamos o thinking nos modelos novos: baixar o esforço é melhor.
   */
  function buildBody(opts) {
    var m = modelOf(opts.model);
    var maxTokens = Math.min(opts.maxTokens || 8000, m.maxOut);

    var body = {
      model: m.id,
      max_tokens: maxTokens,
      stream: opts.stream !== false,
      messages: opts.messages
    };

    /* ------------------------------------------------------------
       CACHE DE PROMPT — a maior economia disponível aqui.

       A API monta o prompt na ordem tools → system → messages, e o
       cache é por prefixo: tudo antes de um marcador é reaproveitado
       nas próximas mensagens por 10% do preço de entrada.

       Como as ferramentas e a personalidade não mudam entre uma
       mensagem e outra, elas são o prefixo perfeito. Por isso
       'system' vem em duas partes: a estável (marcada para cache) e a
       volátil (memória, finanças, hora atual), que fica depois.
       ------------------------------------------------------------ */
    var cachear = opts.cache !== false;

    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools;
      if (cachear) {
        // marcador na última ferramenta = todo o bloco de ferramentas cacheado
        body.tools = opts.tools.slice();
        var ultima = Object.assign({}, body.tools[body.tools.length - 1]);
        ultima.cache_control = { type: 'ephemeral' };
        body.tools[body.tools.length - 1] = ultima;
      }
    }

    if (opts.systemEstavel && cachear) {
      body.system = [
        { type: 'text', text: opts.systemEstavel, cache_control: { type: 'ephemeral' } }
      ];
      if (opts.systemVolatil) body.system.push({ type: 'text', text: opts.systemVolatil });
    } else if (opts.systemEstavel || opts.system) {
      var inteiro = opts.system || (opts.systemEstavel + (opts.systemVolatil ? '\n\n' + opts.systemVolatil : ''));
      body.system = inteiro;
    }

    if (m.effort && opts.effort) body.output_config = { effort: opts.effort };

    if (m.thinking === 'adaptive') {
      body.thinking = { type: 'adaptive' };
      if (opts.showThinking) body.thinking.display = 'summarized';
    } else if (m.thinking === 'budget' && opts.showThinking && maxTokens >= 2048) {
      body.thinking = { type: 'enabled', budget_tokens: Math.max(1024, Math.floor(maxTokens * 0.4)) };
    }
    // 'always' (Fable 5): thinking é sempre ligado e configurá-lo retorna 400 — omitimos.

    var betas = [];
    if (m.fallbacks) {
      // Se um classificador recusar o pedido, o servidor reencaminha para outro
      // modelo em vez de devolver uma resposta vazia.
      betas.push('server-side-fallback-2026-07-01');
      body.fallbacks = 'default';
    }
    return { body: body, betas: betas, model: m };
  }

  /** Converte o histórico do Kao no formato da API (só role/content). */
  function toApiMessages(messages) {
    var out = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.error) continue;                       // erros não voltam para o modelo
      var text = (m.content || '').trim();
      if (!text) continue;
      var role = m.role === 'assistant' ? 'assistant' : 'user';
      // A API não aceita dois turnos seguidos do mesmo papel.
      if (out.length && out[out.length - 1].role === role) {
        out[out.length - 1].content += '\n\n' + text;
      } else {
        out.push({ role: role, content: text });
      }
    }
    while (out.length && out[0].role === 'assistant') out.shift();
    return out;
  }

  /**
   * Remonta os blocos de conteúdo da resposta a partir dos eventos SSE.
   * Precisamos dos blocos originais (inclusive thinking com a assinatura)
   * para devolvê-los intactos na próxima requisição do laço de ferramentas —
   * thinking alterado ou omitido faz a API recusar o turno seguinte.
   */
  function Coletor() {
    this.blocos = [];
    this.jsonParcial = {};
  }
  Coletor.prototype.iniciar = function (i, bloco) {
    this.blocos[i] = JSON.parse(JSON.stringify(bloco || {}));
    if (this.blocos[i].type === 'tool_use') this.jsonParcial[i] = '';
    if (this.blocos[i].type === 'text' && this.blocos[i].text == null) this.blocos[i].text = '';
    if (this.blocos[i].type === 'thinking' && this.blocos[i].thinking == null) this.blocos[i].thinking = '';
  };
  Coletor.prototype.delta = function (i, d) {
    var b = this.blocos[i];
    if (!b) { this.iniciar(i, { type: d.type === 'input_json_delta' ? 'tool_use' : 'text', text: '' }); b = this.blocos[i]; }
    if (d.type === 'text_delta') b.text = (b.text || '') + d.text;
    else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
    else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
    else if (d.type === 'input_json_delta') this.jsonParcial[i] = (this.jsonParcial[i] || '') + d.partial_json;
  };
  Coletor.prototype.fechar = function (i) {
    var b = this.blocos[i];
    if (b && b.type === 'tool_use') {
      try { b.input = JSON.parse(this.jsonParcial[i] || '{}'); }
      catch (e) { b.input = {}; }
    }
  };
  Coletor.prototype.resultado = function () {
    return this.blocos.filter(function (b) { return !!b; });
  };

  var Claude = {
    MODELS: MODELS,
    modelOf: modelOf,
    priceOf: function (id) { return modelOf(id).price; },
    toApiMessages: toApiMessages,

    /** Valida a chave sem gastar tokens; cai para uma chamada mínima se preciso. */
    test: function (apiKey, model) {
      return fetch(MODELS_ENDPOINT + '?limit=1', {
        method: 'GET',
        headers: headers(apiKey)
      }).then(function (res) {
        if (res.ok) return res.json().then(function () { return { ok: true, via: 'models' }; });
        return res.json().catch(function () { return null; }).then(function (b) { throw describe(res.status, b); });
      }).catch(function (err) {
        if (err && err.name === 'ApiError') throw err;
        // Rede/CORS: tenta uma mensagem mínima antes de desistir.
        return Claude.send({
          apiKey: apiKey, model: model || 'claude-haiku-4-5',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 16, stream: false, showThinking: false, effort: 'low'
        }).then(function () { return { ok: true, via: 'messages' }; });
      });
    },

    /** Requisição sem streaming. Retorna { text, usage, stopReason }. */
    send: function (opts) {
      var built = buildBody(Object.assign({}, opts, { stream: false }));
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: headers(opts.apiKey, built.betas),
        body: JSON.stringify(built.body),
        signal: opts.signal
      }).then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return null; }).then(function (b) { throw describe(res.status, b); });
        }
        return res.json();
      }).then(function (data) {
        var text = '';
        (data.content || []).forEach(function (b) { if (b.type === 'text') text += b.text; });
        return { text: text, usage: data.usage || {}, stopReason: data.stop_reason, raw: data };
      }).catch(function (err) {
        throw normalizeNetwork(err);
      });
    },

    /**
     * Streaming SSE.
     * handlers: { onText(chunk), onThinking(chunk), onStart(), onDone(info), onError(err) }
     * Retorna { promise, abort() }.
     */
    stream: function (opts, handlers) {
      handlers = handlers || {};
      var controller = new AbortController();
      var built = buildBody(Object.assign({}, opts, { stream: true }));
      var usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      var stopReason = null, stopDetails = null;
      var fullText = '', fullThinking = '';
      var coletor = new Coletor();

      var promise = fetch(ENDPOINT, {
        method: 'POST',
        headers: headers(opts.apiKey, built.betas),
        body: JSON.stringify(built.body),
        signal: controller.signal
      }).then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return null; }).then(function (b) { throw describe(res.status, b); });
        }
        if (handlers.onStart) handlers.onStart();

        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return finish();
            buffer += decoder.decode(r.value, { stream: true });

            // SSE: eventos separados por linha em branco.
            var parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (var i = 0; i < parts.length; i++) handleEvent(parts[i]);
            return pump();
          });
        }

        function handleEvent(chunk) {
          var lines = chunk.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;

            var ev;
            try { ev = JSON.parse(payload); } catch (e) { continue; }

            if (ev.type === 'message_start' && ev.message && ev.message.usage) {
              var u0 = ev.message.usage;
              usage.input_tokens = u0.input_tokens || 0;
              usage.cache_read_input_tokens = u0.cache_read_input_tokens || 0;
              usage.cache_creation_input_tokens = u0.cache_creation_input_tokens || 0;

            } else if (ev.type === 'content_block_start') {
              coletor.iniciar(ev.index, ev.content_block);
              if (ev.content_block && ev.content_block.type === 'tool_use' && handlers.onTool) {
                handlers.onTool(ev.content_block.name);
              }

            } else if (ev.type === 'content_block_stop') {
              coletor.fechar(ev.index);

            } else if (ev.type === 'content_block_delta') {
              var d = ev.delta || {};
              coletor.delta(ev.index, d);
              if (d.type === 'text_delta' && d.text) {
                fullText += d.text;
                if (handlers.onText) handlers.onText(d.text, fullText);
              } else if (d.type === 'thinking_delta' && d.thinking) {
                fullThinking += d.thinking;
                if (handlers.onThinking) handlers.onThinking(d.thinking, fullThinking);
              }

            } else if (ev.type === 'message_delta') {
              if (ev.usage && ev.usage.output_tokens) usage.output_tokens = ev.usage.output_tokens;
              if (ev.delta) {
                stopReason = ev.delta.stop_reason || stopReason;
                stopDetails = ev.delta.stop_details || stopDetails;
              }

            } else if (ev.type === 'error') {
              throw ApiError((ev.error && ev.error.message) || 'Erro no streaming.', (ev.error && ev.error.type) || 'stream', 0);
            }
          }
        }

        function finish() {
          var blocos = coletor.resultado();
          var info = {
            text: fullText, thinking: fullThinking, usage: usage,
            stopReason: stopReason, stopDetails: stopDetails,
            blocos: blocos,
            ferramentas: blocos.filter(function (b) { return b.type === 'tool_use'; })
          };
          if (stopReason === 'refusal') {
            info.refused = true;
            if (!fullText) {
              info.text = 'Não consigo responder a esse pedido específico. Se ele foi mal interpretado, reformule com mais contexto.';
            }
          }
          if (handlers.onDone) handlers.onDone(info);
          return info;
        }

        return pump();
      }).catch(function (err) {
        if (err && err.name === 'AbortError') {
          var partial = { text: fullText, thinking: fullThinking, usage: usage, aborted: true, blocos: [], ferramentas: [] };
          if (handlers.onDone) handlers.onDone(partial);
          return partial;
        }
        var e = normalizeNetwork(err);
        if (handlers.onError) handlers.onError(e);
        throw e;
      });

      return { promise: promise, abort: function () { controller.abort(); } };
    }
  };

  function normalizeNetwork(err) {
    if (err && err.name === 'ApiError') return err;
    if (err && err.name === 'AbortError') return err;
    if (!navigator.onLine) return ApiError('Você está sem conexão com a internet.', 'offline', 0);
    return ApiError('Não foi possível falar com a API da Anthropic. Verifique sua conexão.', 'network', 0);
  }

  global.Claude = Claude;
})(window);
