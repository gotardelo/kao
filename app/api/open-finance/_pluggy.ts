const PLUGGY_API = 'https://api.pluggy.ai';

type ApiError = { error?: { message?: string } };

function credentials() {
  const clientId = String(process.env.PLUGGY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PLUGGY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('Open Finance ainda nao foi configurado neste site.');
  return { clientId, clientSecret };
}

export function configured() {
  return Boolean(String(process.env.PLUGGY_CLIENT_ID || '').trim() && String(process.env.PLUGGY_CLIENT_SECRET || '').trim());
}

export function badRequest(message: string, status = 400) {
  return Response.json({ error: { message } }, { status });
}

export async function body(request: Request) {
  return await request.json() as Record<string, unknown>;
}

async function apiKey() {
  const auth = await fetch(`${PLUGGY_API}/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...credentials(), nonExpiring: false }),
  });
  if (!auth.ok) throw new Error('As credenciais do Open Finance foram recusadas.');
  const data = await auth.json() as { apiKey?: string };
  if (!data.apiKey) throw new Error('O Open Finance nao retornou uma chave de sessao.');
  return data.apiKey;
}

export async function pluggy(path: string, init: RequestInit = {}) {
  const response = await fetch(`${PLUGGY_API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-api-key': await apiKey(), ...(init.headers || {}) },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as ApiError;
    throw new Error(error.error?.message || `Open Finance indisponivel (HTTP ${response.status}).`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

export async function assertOwnedItem(itemId: string, clientUserId: string) {
  if (!/^[0-9a-f-]{20,}$/i.test(itemId) || !/^kao-[0-9a-z-]{12,}$/i.test(clientUserId)) {
    throw new Error('Referencia de conexao invalida.');
  }
  const item = await pluggy(`/items/${encodeURIComponent(itemId)}`);
  if (String(item.clientUserId || '') !== clientUserId) throw new Error('Esta conexao bancaria nao pertence a esta conta.');
  return item;
}

export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Nao foi possivel concluir a operacao financeira.';
  return badRequest(message, /nao pertence|invalida/i.test(message) ? 403 : 400);
}
