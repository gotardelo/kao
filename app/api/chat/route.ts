const OPENAI = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';

type Message = {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: { message } }, { status });
}

function anthropicMessages(messages: Message[]) {
  let system = '';
  const output: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      system += (system ? '\n\n' : '') + String(message.content || '');
      continue;
    }
    if (message.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: String(message.tool_call_id || ''), content: String(message.content || '') };
      const previous = output[output.length - 1];
      if (previous && previous.role === 'user' && Array.isArray(previous.content)) {
        (previous.content as unknown[]).push(block);
      } else {
        output.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: unknown[] = [];
      if (message.content) blocks.push({ type: 'text', text: String(message.content) });
      for (const call of message.tool_calls || []) {
        let input: unknown = {};
        try { input = JSON.parse(call.function?.arguments || '{}'); } catch { /* invalid tool JSON is rejected upstream */ }
        blocks.push({ type: 'tool_use', id: call.id, name: call.function?.name, input });
      }
      output.push({ role: 'assistant', content: blocks });
      continue;
    }
    output.push({ role: 'user', content: String(message.content || '') });
  }
  return { system, messages: output };
}

function anthropicPayload(payload: Record<string, unknown>) {
  const converted = anthropicMessages(Array.isArray(payload.messages) ? payload.messages as Message[] : []);
  const tools = Array.isArray(payload.tools) ? payload.tools.map((tool: any) => ({
    name: tool.function?.name,
    description: tool.function?.description || '',
    input_schema: tool.function?.parameters || { type: 'object', properties: {} },
  })) : undefined;
  return {
    model: String(payload.model || 'claude-sonnet-4-5'),
    max_tokens: Math.min(Math.max(Number(payload.max_completion_tokens) || 4000, 1), 64000),
    stream: payload.stream !== false,
    system: converted.system || undefined,
    messages: converted.messages,
    tools: tools?.length ? tools : undefined,
    tool_choice: tools?.length ? { type: 'auto' } : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const provider = body.provider === 'anthropic' ? 'anthropic' : 'openai';
    const apiKey = String(body.apiKey || '').trim();
    const valid = provider === 'anthropic' ? /^sk-ant-/ : /^sk-/;
    if (!valid.test(apiKey)) return jsonError(provider === 'anthropic' ? 'Chave da Anthropic invalida.' : 'Chave da OpenAI invalida.');
    const payload = (body.payload || {}) as Record<string, unknown>;
    const isAnthropic = provider === 'anthropic';
    const upstream = await fetch(isAnthropic ? ANTHROPIC : OPENAI, {
      method: 'POST',
      headers: isAnthropic
        ? { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(isAnthropic ? anthropicPayload(payload) : payload),
      signal: request.signal,
    });
    if (!upstream.ok) {
      return Response.json(await upstream.json().catch(() => ({ error: { message: upstream.statusText } })), { status: upstream.status });
    }
    return new Response(upstream.body, {
      headers: {
        'content-type': payload.stream === false ? 'application/json; charset=utf-8' : 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return jsonError('Requisicao cancelada.', 499);
    return jsonError(error instanceof Error ? error.message : 'Nao foi possivel chamar a API.', 500);
  }
}
