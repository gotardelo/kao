import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type PasswordRecord = { salt: string; hash: string; iter: number };
type UserRow = {
  id: string;
  email: string;
  name: string;
  pw: string;
  created_at: number;
  updated_at: number;
  last_login: number | null;
};
type SessionRow = UserRow & { session_id: string; expires_at: number };
type DataRecord = { key: string; value: string | null; updated_at: number };
type VaultRow = { provider: string; ciphertext: string; iv: string; updated_at: number };

const COOKIE = 'kao_session';
const DAY = 86_400_000;
const PASSWORD_ITERATIONS = 210_000;
const MAX_RECORDS_PER_PUSH = 200;
const MAX_VALUE_BYTES = 4 * 1024 * 1024;
const SYNC_PREFIXES = [
  'convs',
  'config',
  'usage',
  'progress',
  'avatar',
  'profile',
  'persona',
  'memoria',
  'financas',
  'api-alert',
  'open-finance',
];

let schemaReady: Promise<void> | null = null;

function db() {
  const binding = env.KAO_DB;
  if (!binding) throw new Error('Banco de dados nao configurado para este site.');
  return binding;
}

function json(body: unknown, status = 200, cookie?: string) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function publicUser(row: Pick<UserRow, 'id' | 'name' | 'email' | 'created_at' | 'last_login'>) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
    lastLogin: row.last_login || 0,
  };
}

function normEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normName(value: unknown) {
  return String(value || '').trim().slice(0, 120);
}

function emailOk(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function randomId(prefix = '') {
  if (crypto.randomUUID) return prefix + crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return prefix + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToB64(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}

function b64ToBytes(input: string) {
  const raw = atob(input);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function sha256(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashPassword(password: string, saltB64?: string, iter = PASSWORD_ITERATIONS): Promise<PasswordRecord> {
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return { salt: bytesToB64(salt), hash: bytesToB64(bits), iter };
}

function parsePasswordRecord(raw: unknown) {
  const record = typeof raw === 'string' ? JSON.parse(raw) as PasswordRecord : raw as PasswordRecord;
  if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string') {
    throw new Error('Registro de senha invalido.');
  }
  return {
    salt: record.salt,
    hash: record.hash,
    iter: Number(record.iter) || PASSWORD_ITERATIONS,
  };
}

async function verifyPassword(password: string, raw: unknown) {
  try {
    const record = parsePasswordRecord(raw);
    const next = await hashPassword(password, record.salt, record.iter);
    return constantEqual(next.hash, record.hash);
  } catch {
    return false;
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    const database = db();
    schemaReady = database.batch([
      database.prepare(
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          pw TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_login INTEGER
        )`,
      ),
      database.prepare(
        `CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
      ),
      database.prepare(
        `CREATE TABLE IF NOT EXISTS user_data (
          user_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, key)
        )`,
      ),
      database.prepare(
        `CREATE TABLE IF NOT EXISTS vault_keys (
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          iv TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, provider)
        )`,
      ),
      database.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)'),
      database.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'),
    ]).then(() => undefined);
  }
  await schemaReady;
}

async function userByEmail(email: string) {
  return db().prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
}

async function userById(id: string) {
  return db().prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

function cookieParts(request: Request) {
  const secure = new URL(request.url).protocol === 'https:';
  return [`Path=/`, `HttpOnly`, `SameSite=Lax`, secure ? 'Secure' : ''].filter(Boolean);
}

async function createSession(request: Request, userId: string, remember = true) {
  const now = Date.now();
  const token = randomId('ks_');
  const tokenHash = await sha256(token);
  const expiresAt = now + (remember ? 30 * DAY : DAY);
  await db().prepare(
    'INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(randomId(), tokenHash, userId, now, expiresAt).run();
  const maxAge = Math.max(1, Math.floor((expiresAt - now) / 1000));
  return `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; ${cookieParts(request).join('; ')}`;
}

function clearCookie(request: Request) {
  return `${COOKIE}=; Max-Age=0; ${cookieParts(request).join('; ')}`;
}

function parseCookies(request: Request) {
  const raw = request.headers.get('cookie') || '';
  const out = new Map<string, string>();
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return out;
}

async function currentSession(request: Request) {
  const token = parseCookies(request).get(COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await db().prepare(
    `SELECT users.*, sessions.id AS session_id, sessions.expires_at AS expires_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`,
  ).bind(tokenHash).first<SessionRow>();
  if (!row) return null;
  if (row.expires_at < now) {
    await db().prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run().catch(() => undefined);
    return null;
  }
  return row;
}

async function requireUser(request: Request) {
  const row = await currentSession(request);
  if (!row) throw Object.assign(new Error('Sessao expirada. Entre de novo.'), { status: 401 });
  return row;
}

function validClientUser(value: unknown) {
  const user = value as { id?: unknown; name?: unknown; email?: unknown; pw?: unknown; createdAt?: unknown };
  const id = String(user?.id || '').trim();
  const name = normName(user?.name);
  const email = normEmail(user?.email);
  if (!/^[a-z0-9_-][a-z0-9_.:-]{5,120}$/i.test(id) && !/^[0-9a-f-]{32,}$/i.test(id)) {
    throw new Error('Identificador local invalido.');
  }
  if (name.length < 2) throw new Error('Digite seu nome.');
  if (!emailOk(email)) throw new Error('E-mail invalido.');
  const pw = parsePasswordRecord(user?.pw);
  return {
    id,
    name,
    email,
    pw: JSON.stringify(pw),
    createdAt: Math.max(0, Number(user?.createdAt) || Date.now()),
  };
}

function validateProvider(value: unknown) {
  const provider = String(value || 'openai').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(provider)) throw new Error('Provedor invalido.');
  return provider;
}

function keyAllowed(key: string, userId: string) {
  if (!key.startsWith('kao:')) return false;
  if (key === 'kao:users' || key === 'kao:session') return false;
  if (key.startsWith('kao:sync:') || key.startsWith('kao:apikey:')) return false;
  return SYNC_PREFIXES.some((prefix) => key === `kao:${prefix}:${userId}`);
}

function validateRecords(records: unknown, userId: string) {
  if (!Array.isArray(records)) throw new Error('Lista de sincronizacao invalida.');
  if (records.length > MAX_RECORDS_PER_PUSH) throw new Error('Muitas alteracoes de uma vez. Tente novamente.');
  return records.map((record) => {
    const item = record as { key?: unknown; value?: unknown; updatedAt?: unknown };
    const key = String(item.key || '').trim();
    if (!keyAllowed(key, userId)) throw new Error('Chave de sincronizacao invalida.');
    const value = item.value === null ? null : String(item.value ?? '');
    if (value !== null && new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
      throw new Error('Um item ficou grande demais para sincronizar.');
    }
    const updatedAt = Math.max(1, Math.floor(Number(item.updatedAt) || Date.now()));
    return { key, value, updatedAt };
  });
}

async function vaultKey(provider: string, userId: string) {
  const secret = String(process.env.KAO_VAULT_SECRET || env.KAO_VAULT_SECRET || 'kao-local-dev-vault-secret').trim();
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kao:vault:${secret}`));
  const key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const aad = new TextEncoder().encode(`${userId}:${provider}`);
  return { key, aad };
}

async function encryptVault(provider: string, userId: string, plain: string) {
  const { key, aad } = await vaultKey(provider, userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    new TextEncoder().encode(plain),
  );
  return { iv: bytesToB64(iv), ciphertext: bytesToB64(data) };
}

async function decryptVault(row: VaultRow, userId: string) {
  const { key, aad } = await vaultKey(row.provider, userId);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(row.iv), additionalData: aad },
    key,
    b64ToBytes(row.ciphertext),
  );
  return new TextDecoder().decode(plain);
}

async function handleSignup(request: Request, body: Record<string, unknown>) {
  const name = normName(body.name);
  const email = normEmail(body.email);
  const password = String(body.password || '');
  if (name.length < 2) throw new Error('Digite seu nome.');
  if (!emailOk(email)) throw new Error('E-mail invalido.');
  if (password.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres.');
  if (await userByEmail(email)) return json({ error: { message: 'Ja existe uma conta com esse e-mail.' } }, 409);

  const now = Date.now();
  const userId = randomId();
  const pw = await hashPassword(password);
  await db().prepare(
    'INSERT INTO users (id, email, name, pw, created_at, updated_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(userId, email, name, JSON.stringify(pw), now, now, now).run();
  const row = await userById(userId);
  if (!row) throw new Error('Nao foi possivel criar a conta.');
  return json({ ok: true, user: publicUser(row), created: true }, 200, await createSession(request, userId, true));
}

async function handleLogin(request: Request, body: Record<string, unknown>) {
  const email = normEmail(body.email);
  const password = String(body.password || '');
  const remember = body.remember !== false;
  const fail = { error: { message: 'E-mail ou senha incorretos.' } };
  const row = emailOk(email) ? await userByEmail(email) : null;
  if (!row) {
    await hashPassword(password || 'senha-invalida');
    return json(fail, 401);
  }
  if (!await verifyPassword(password, row.pw)) return json(fail, 401);
  const now = Date.now();
  await db().prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').bind(now, now, row.id).run();
  row.last_login = now;
  row.updated_at = now;
  return json({ ok: true, user: publicUser(row) }, 200, await createSession(request, row.id, remember));
}

async function handleMigrate(request: Request, body: Record<string, unknown>) {
  const local = validClientUser(body.user);
  const existing = await userByEmail(local.email);
  if (existing && existing.id !== local.id) {
    return json({
      error: {
        code: 'LOGIN_REQUIRED',
        message: 'Essa conta ja esta sincronizada. Entre de novo para juntar este aparelho.',
      },
    }, 409);
  }

  const now = Date.now();
  if (!existing) {
    await db().prepare(
      'INSERT INTO users (id, email, name, pw, created_at, updated_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(local.id, local.email, local.name, local.pw, local.createdAt, now, now).run();
  } else {
    await db().prepare('UPDATE users SET name = ?, updated_at = ?, last_login = ? WHERE id = ?')
      .bind(local.name || existing.name, now, now, existing.id)
      .run();
  }

  const row = await userByEmail(local.email);
  if (!row) throw new Error('Nao foi possivel sincronizar a conta local.');
  return json({ ok: true, user: publicUser(row), created: !existing }, 200, await createSession(request, row.id, true));
}

async function handlePull(request: Request) {
  const user = await requireUser(request);
  const rows = await db().prepare(
    'SELECT key, value, updated_at FROM user_data WHERE user_id = ? ORDER BY updated_at ASC',
  ).bind(user.id).all<DataRecord>();
  return json({
    ok: true,
    user: publicUser(user),
    records: (rows.results || []).map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at })),
  });
}

async function handlePush(request: Request, body: Record<string, unknown>) {
  const user = await requireUser(request);
  const records = validateRecords(body.records, user.id);
  if (!records.length) return json({ ok: true, saved: 0 });

  const database = db();
  const statements = records.map((record) => database.prepare(
    `INSERT INTO user_data (user_id, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at
     WHERE user_data.updated_at <= excluded.updated_at`,
  ).bind(user.id, record.key, record.value, record.updatedAt));

  for (let i = 0; i < statements.length; i += 50) {
    await database.batch(statements.slice(i, i + 50));
  }
  return json({ ok: true, saved: records.length });
}

async function handleUpdateProfile(request: Request, body: Record<string, unknown>) {
  const user = await requireUser(request);
  const name = normName(body.name);
  const email = normEmail(body.email);
  if (name.length < 2) throw new Error('Digite seu nome.');
  if (!emailOk(email)) throw new Error('E-mail invalido.');
  const other = await userByEmail(email);
  if (other && other.id !== user.id) return json({ error: { message: 'Esse e-mail ja esta em uso.' } }, 409);
  const now = Date.now();
  await db().prepare('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?')
    .bind(name, email, now, user.id)
    .run();
  const row = await userById(user.id);
  if (!row) throw new Error('Sessao invalida.');
  return json({ ok: true, user: publicUser(row) });
}

async function handleChangePassword(request: Request, body: Record<string, unknown>) {
  const user = await requireUser(request);
  const current = String(body.current || '');
  const next = String(body.next || '');
  const next2 = String(body.next2 || '');
  if (next.length < 8) throw new Error('A nova senha precisa ter ao menos 8 caracteres.');
  if (next !== next2) throw new Error('As senhas nao conferem.');
  if (!await verifyPassword(current, user.pw)) return json({ error: { message: 'Senha atual incorreta.' } }, 401);
  const now = Date.now();
  await db().prepare('UPDATE users SET pw = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(await hashPassword(next)), now, user.id)
    .run();
  return json({ ok: true });
}

async function handleVaultSave(request: Request, body: Record<string, unknown>) {
  const user = await requireUser(request);
  const provider = validateProvider(body.provider);
  const value = String(body.value || '').trim();
  if (!value) {
    await db().prepare('DELETE FROM vault_keys WHERE user_id = ? AND provider = ?').bind(user.id, provider).run();
    return json({ ok: true, cleared: true });
  }
  const encrypted = await encryptVault(provider, user.id, value);
  const now = Date.now();
  await db().prepare(
    `INSERT INTO vault_keys (user_id, provider, ciphertext, iv, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       updated_at = excluded.updated_at`,
  ).bind(user.id, provider, encrypted.ciphertext, encrypted.iv, now).run();
  return json({ ok: true, savedAt: now });
}

async function handleVaultLoad(request: Request, body: Record<string, unknown>) {
  const user = await requireUser(request);
  const provider = validateProvider(body.provider);
  const row = await db().prepare(
    'SELECT provider, ciphertext, iv, updated_at FROM vault_keys WHERE user_id = ? AND provider = ?',
  ).bind(user.id, provider).first<VaultRow>();
  if (!row) return json({ ok: true, value: '' });
  return json({ ok: true, value: await decryptVault(row, user.id), savedAt: row.updated_at });
}

async function handleVaultClear(request: Request, body: Record<string, unknown>) {
  const user = await requireUser(request);
  const provider = validateProvider(body.provider);
  await db().prepare('DELETE FROM vault_keys WHERE user_id = ? AND provider = ?').bind(user.id, provider).run();
  return json({ ok: true });
}

async function handleLogout(request: Request) {
  const token = parseCookies(request).get(COOKIE);
  if (token) {
    await db().prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, clearCookie(request));
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || '');
    switch (action) {
      case 'signup':
        return await handleSignup(request, body);
      case 'login':
        return await handleLogin(request, body);
      case 'migrate':
        return await handleMigrate(request, body);
      case 'me': {
        const user = await requireUser(request);
        return json({ ok: true, user: publicUser(user) });
      }
      case 'pull':
        return await handlePull(request);
      case 'push':
        return await handlePush(request, body);
      case 'updateProfile':
        return await handleUpdateProfile(request, body);
      case 'changePassword':
        return await handleChangePassword(request, body);
      case 'vaultSave':
        return await handleVaultSave(request, body);
      case 'vaultLoad':
        return await handleVaultLoad(request, body);
      case 'vaultClear':
        return await handleVaultClear(request, body);
      case 'logout':
        return await handleLogout(request);
      default:
        return json({ error: { message: 'Acao de sincronizacao desconhecida.' } }, 404);
    }
  } catch (error) {
    const status = Number((error as { status?: unknown }).status) || 400;
    const message = error instanceof Error ? error.message : 'Nao foi possivel sincronizar.';
    return json({ error: { message } }, status);
  }
}
