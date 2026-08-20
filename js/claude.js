/* ============================================================
   TDAHZEI - cliente OpenAI (mantem o nome Claude para compatibilidade)
   Usa o proxy local em server.js para evitar CORS e habilitar voz.
   ============================================================ */
(function (global) {
  'use strict';

  var CHAT_PROXY = '/api/chat';
  var TEST_PROXY = '/api/test';

  /* Precos em US$ por 1M de tokens, conforme catalogo OpenAI. */
  var MODELS = [
    {
      id: 'gpt-5.6-terra',
      name: 'GPT-5.6 Terra',
      tag: 'Recomendado',
      desc: 'Equilibrio bom entre inteligencia, velocidade e custo para uso diario.',
      ctx: 1050000, maxOut: 128000,
      provider: 'openai', price: { in: 2, out: 12 },
      effort: true
    },
    {
      id: 'gpt-5.6-luna',
      name: 'GPT-5.6 Luna',
      tag: 'Economico',
      desc: 'Barato e rapido para alto volume, check-ins e conversas curtas.',
      ctx: 1050000, maxOut: 128000,
      provider: 'openai', price: { in: 0.2, out: 1.2 },
      effort: true
    },
    {
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      tag: 'Maximo',
      desc: 'Modelo frontier para raciocinio mais forte, planejamento e trabalho complexo.',
      ctx: 1050000, maxOut: 128000,
      provider: 'openai', price: { in: 5, out: 30 },
      effort: true
    },
    {
      id: 'gpt-5-mini',
      name: 'GPT-5 mini',
      tag: 'Compatibilidade',
      desc: 'Modelo GPT-5 mais antigo, util caso sua conta ainda nao tenha GPT-5.6.',
      ctx: 400000, maxOut: 128000,
      provider: 'openai', price: { in: 0.25, out: 2 },
      effort: true
    },
    {
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      tag: 'Recomendado',
      desc: 'Equilibrio entre raciocinio, escrita e velocidade para o uso diario.',
      ctx: 200000, maxOut: 64000,
      provider: 'anthropic', price: { in: 3, out: 15 }, effort: false
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      tag: 'Economico',
      desc: 'Rapido e economico para check-ins, listas e conversas curtas.',
      ctx: 200000, maxOut: 64000,
      provider: 'anthropic', price: { in: 1, out: 5 }, effort: false
    },
    {
      id: 'claude-opus-4-5',
      name: 'Claude Opus 4.5',
      tag: 'Maximo',
      desc: 'Maior capacidade para planejamento e tarefas complexas.',
      ctx: 200000, maxOut: 64000,
      provider: 'anthropic', price: { in: 5, out: 25 }, effort: false
    }
  ];

  /* Modelos de voz. Nao entram no seletor do chat, mas precisam de preco:
     audio custa MUITO mais que texto, e o teto mensal so protege se souber
     contar isso. Valores em US$ por 1M de tokens de audio. */
  var VOZ_MODELS = [
    { id: 'gpt-realtime-2.1',      name: 'GPT Realtime 2.1',      price: { in: 32, out: 64 } },
    { id: 'gpt-realtime-2.1-mini', name: 'GPT Realtime 2.1 mini', price: { in: 10, out: 20 } },
    { id: 'gpt-realtime-2',        name: 'GPT Realtime 2',        price: { in: 32, out: 64 } },
    { id: 'gpt-realtime-1.5',      name: 'GPT Realtime 1.5',      price: { in: 32, out: 64 } }
  ];

  function modelOf(id) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i];
    return MODELS[0];
  }

  function modelsFor(provider) {
    return MODELS.filter(function (model) { return model.provider === (provider || 'openai'); });
  }

  function providerOf(model, provider) {
    return provider || modelOf(model).provider || 'openai';
  }

  function vozModelOf(id) {
    for (var i = 0; i < VOZ_MODELS.length; i++) if (VOZ_MODELS[i].id === id) return VOZ_MODELS[i];
    return VOZ_MODELS[0];
  }

  function ApiError(message, kind, status) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.kind = kind || 'unknown';
    e.status = status || 0;
    return e;
  }

  function describe(status, body, provider) {
    var service = provider === 'anthropic' ? 'Claude' : 'OpenAI';
    var err = body && body.error;
    var type = (err && (err.type || err.code)) || '';
    var msg = (err && err.message) || '';
    switch (status) {
      case 400:
        return ApiError('Requisicao invalida: ' + (msg || 'confira modelo, chave e configuracoes.'), 'invalid_request', 400);
      case 401:
        return ApiError('Chave da ' + service + ' invalida ou revogada. Confira em Chave & Modelo.', 'auth', 401);
      case 403:
        return ApiError('Sua chave nao tem permissao para esse modelo ou recurso.', 'permission', 403);
      case 404:
        return ApiError('Modelo ou endpoint nao encontrado para esta conta' +
          (msg ? ': ' + msg : '. Escolha outro modelo em Chave & Modelo.'), 'not_found', 404);
      case 413:
        return ApiError('A conversa ficou grande demais para uma requisicao.', 'too_large', 413);
      case 429:
        return ApiError('Limite de uso atingido. Aguarde alguns segundos e tente de novo.', 'rate_limit', 429);
      case 500: case 502: case 503:
        return ApiError('A API da ' + service + ' teve um erro temporario. Tente novamente.', 'server', status);
      default:
        return ApiError(msg || ('Erro inesperado (HTTP ' + status + ').'), type || 'unknown', status);
    }
  }

  function request(path, body, signal) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return null; })
          .then(function (b) { throw describe(res.status, b, body.provider); });
      }
      return res;
    }).catch(function (err) {
      throw normalizeNetwork(err);
    });
  }

  function buildSystem(opts) {
    var chunks = [];
    if (opts.system) chunks.push(opts.system);
    if (opts.systemEstavel) chunks.push(opts.systemEstavel);
    if (opts.systemVolatil) chunks.push(opts.systemVolatil);
    return chunks.filter(Boolean).join('\n\n');
  }

  function toOpenAITools(tools) {
    if (!tools || !tools.length) return null;
    return tools.map(function (t) {
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || t.parameters || { type: 'object', properties: {}, additionalProperties: false },
          strict: t.strict !== false
        }
      };
    });
  }

  function buildBody(opts) {
    var m = modelOf(opts.model);
    var maxTokens = Math.min(opts.maxTokens || 4000, m.maxOut);
    var messages = (opts.messages || []).slice();
    var system = buildSystem(opts);
    if (system) messages.unshift({ role: 'system', content: system });

    var body = {
      model: m.id,
      messages: messages,
      stream: opts.stream !== false,
      max_completion_tokens: maxTokens
    };

    if (body.stream) body.stream_options = { include_usage: true };
    if (m.effort && opts.effort && opts.effort !== 'none') body.reasoning_effort = opts.effort;

    var converted = toOpenAITools(opts.tools);
    if (converted) {
      body.tools = converted;
      body.tool_choice = 'auto';
    }

    return { body: body, model: m };
  }

  /**
   * Segunda tentativa quando a API recusa a requisicao: alguns modelos e
   * algumas contas nao aceitam reasoning_effort ou schema estrito de
   * ferramenta. Melhor responder sem esses extras do que falhar.
   */
  function modoSeguro(body) {
    var b = JSON.parse(JSON.stringify(body));
    delete b.reasoning_effort;
    if (b.tools) {
      b.tools = b.tools.map(function (t) {
        if (t.function) t.function.strict = false;
        return t;
      });
    }
    return b;
  }

  function vaiAdiantarTentarDeNovo(err, jaTentou) {
    if (jaTentou || !err || err.name !== 'ApiError') return false;
    if (err.status !== 400) return false;
    return /reasoning_effort|effort|strict|schema|unsupported|unknown parameter/i.test(err.message || '');
  }

  function toApiMessages(messages) {
    var out = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.error) continue;
      var text = String(m.content || '').trim();
      if (!text) continue;
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text });
    }
    while (out.length && out[0].role === 'assistant') out.shift();
    return out;
  }

  function normalizeUsage(usage) {
    usage = usage || {};
    var prompt = usage.prompt_tokens || usage.input_tokens || 0;
    var completion = usage.completion_tokens || usage.output_tokens || 0;
    var details = usage.prompt_tokens_details || usage.input_tokens_details || {};
    var cached = details.cached_tokens || details.cache_read_input_tokens || usage.cache_read_input_tokens || 0;
    return {
      input_tokens: Math.max(0, prompt - cached),
      output_tokens: completion,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0
    };
  }

  function parseToolArgs(str) {
    try { return JSON.parse(str || '{}'); }
    catch (_) { return {}; }
  }

  function appendToolResults(history, info, resultados) {
    var calls = (info.ferramentas || []).map(function (t) {
      return {
        id: t.id,
        type: 'function',
        function: {
          name: t.name,
          arguments: t.arguments || JSON.stringify(t.input || {})
        }
      };
    });

    var next = history.concat([{
      role: 'assistant',
      content: info.text || null,
      tool_calls: calls
    }]);

    (resultados || []).forEach(function (r) {
      next.push({
        role: 'tool',
        tool_call_id: r.tool_use_id,
        content: String(r.content || r.conteudo || '')
      });
    });
    return next;
  }

  var Claude = {
    MODELS: MODELS,
    VOZ_MODELS: VOZ_MODELS,
    modelOf: modelOf,
    vozModelOf: vozModelOf,
    ehModeloDeVoz: function (id) {
      for (var i = 0; i < VOZ_MODELS.length; i++) if (VOZ_MODELS[i].id === id) return true;
      return false;
    },
    priceOf: function (id) {
      for (var i = 0; i < VOZ_MODELS.length; i++) if (VOZ_MODELS[i].id === id) return VOZ_MODELS[i].price;
      return modelOf(id).price;
    },
    toApiMessages: toApiMessages,
    appendToolResults: appendToolResults,

    modelsFor: modelsFor,
    providerOf: providerOf,

    test: function (apiKey, provider) {
      return request(TEST_PROXY, { apiKey: apiKey, provider: provider }).then(function (res) {
        return res.json().then(function () { return { ok: true }; });
      });
    },

    send: function (opts) {
      var built = buildBody(Object.assign({}, opts, { stream: false }));
      function pedir(payload, jaTentou) {
        return request(CHAT_PROXY, { apiKey: opts.apiKey, provider: providerOf(opts.model, opts.provider), payload: payload }, opts.signal)
          .catch(function (err) {
            if (!vaiAdiantarTentarDeNovo(err, jaTentou)) throw err;
            return pedir(modoSeguro(payload), true);
          });
      }
      return pedir(built.body, false).then(function (res) {
        return res.json();
      }).then(function (data) {
        var choice = data.choices && data.choices[0];
        var msg = (choice && choice.message) || {};
        return {
          text: msg.content || '',
          usage: normalizeUsage(data.usage),
          stopReason: choice && choice.finish_reason,
          raw: data
        };
      });
    },

    stream: function (opts, handlers) {
      handlers = handlers || {};
      var controller = new AbortController();
      var built = buildBody(Object.assign({}, opts, { stream: true }));
      var fullText = '';
      var usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      var stopReason = null;
      var toolCalls = [];
      var notifiedTools = {};

      function handleAnthropicEvent(ev) {
        var index = ev.index || 0;
        if (ev.type === 'message_start' && ev.message && ev.message.usage) {
          var started = normalizeUsage(ev.message.usage);
          usage.input_tokens = started.input_tokens;
          usage.cache_read_input_tokens = started.cache_read_input_tokens;
          usage.cache_creation_input_tokens = started.cache_creation_input_tokens;
          return;
        }
        if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') {
          toolCalls[index] = {
            id: ev.content_block.id || '',
            name: ev.content_block.name || '',
            arguments: ''
          };
          if (!notifiedTools[index] && handlers.onTool) {
            notifiedTools[index] = true;
            handlers.onTool(toolCalls[index].name);
          }
          return;
        }
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            fullText += ev.delta.text;
            if (handlers.onText) handlers.onText(ev.delta.text, fullText);
          }
          if (ev.delta.type === 'input_json_delta') {
            if (!toolCalls[index]) toolCalls[index] = { id: '', name: '', arguments: '' };
            toolCalls[index].arguments += ev.delta.partial_json || '';
          }
          return;
        }
        if (ev.type === 'message_delta') {
          if (ev.usage) {
            usage.output_tokens = ev.usage.output_tokens || 0;
            usage.cache_read_input_tokens = ev.usage.cache_read_input_tokens || usage.cache_read_input_tokens;
          }
          var reason = ev.delta && ev.delta.stop_reason;
          if (reason) stopReason = reason === 'tool_use' ? 'tool_use' : reason;
        }
      }

      function pedir(payload, jaTentou) {
        return request(CHAT_PROXY, { apiKey: opts.apiKey, provider: providerOf(opts.model, opts.provider), payload: payload }, controller.signal)
          .catch(function (err) {
            if (!vaiAdiantarTentarDeNovo(err, jaTentou)) throw err;
            return pedir(modoSeguro(payload), true);
          });
      }

      var promise = pedir(built.body, false).then(function (res) {
        if (handlers.onStart) handlers.onStart();
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return finish();
            buffer += decoder.decode(r.value, { stream: true });
            var parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (var i = 0; i < parts.length; i++) handleEvent(parts[i]);
            return pump();
          });
        }

        function handleEvent(chunk) {
          var lines = chunk.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;

            var ev;
            try { ev = JSON.parse(payload); } catch (_) { continue; }
            if (ev.type) { handleAnthropicEvent(ev); continue; }
            if (ev.usage) usage = normalizeUsage(ev.usage);

            var choice = ev.choices && ev.choices[0];
            if (!choice) continue;
            if (choice.finish_reason) {
              stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use'
                : choice.finish_reason === 'length' ? 'max_tokens'
                : choice.finish_reason;
            }

            var delta = choice.delta || {};
            if (delta.content) {
              fullText += delta.content;
              if (handlers.onText) handlers.onText(delta.content, fullText);
            }

            if (delta.tool_calls) {
              delta.tool_calls.forEach(function (part) {
                var idx = part.index || 0;
                if (!toolCalls[idx]) toolCalls[idx] = { id: '', name: '', arguments: '' };
                var t = toolCalls[idx];
                if (part.id) t.id = part.id;
                if (part.function) {
                  if (part.function.name) {
                    t.name = part.function.name;
                    if (!notifiedTools[idx] && handlers.onTool) {
                      notifiedTools[idx] = true;
                      handlers.onTool(t.name);
                    }
                  }
                  if (part.function.arguments) t.arguments += part.function.arguments;
                }
              });
            }
          }
        }

        function finish() {
          var ferramentas = toolCalls.filter(Boolean).map(function (t) {
            return {
              id: t.id,
              name: t.name,
              arguments: t.arguments,
              input: parseToolArgs(t.arguments)
            };
          });
          var info = {
            text: fullText,
            thinking: '',
            usage: usage,
            stopReason: stopReason,
            blocos: [],
            ferramentas: ferramentas
          };
          if (handlers.onDone) handlers.onDone(info);
          return info;
        }

        return pump();
      }).catch(function (err) {
        if (err && err.name === 'AbortError') {
          var partial = {
            text: fullText,
            thinking: '',
            usage: usage,
            aborted: true,
            blocos: [],
            ferramentas: []
          };
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
    if (!navigator.onLine) return ApiError('Voce esta sem conexao com a internet.', 'offline', 0);
    if (err && /Failed to fetch|NetworkError|Load failed/i.test(err.message || '')) {
      return ApiError('Nao consegui acessar o servidor local. Rode "npm start" e abra pelo localhost.', 'network', 0);
    }
    return ApiError((err && err.message) || 'Nao foi possivel falar com a API da OpenAI.', 'network', 0);
  }

  global.Claude = Claude;
  global.OpenAIKao = Claude;
})(window);
