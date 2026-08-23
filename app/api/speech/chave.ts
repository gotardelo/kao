const FORMATO = /^sk_[a-zA-Z0-9_-]+$/;

/**
 * Chave guardada no ambiente do deploy: fica salva de vez, nunca vai no bundle
 * do navegador e sobrevive a limpar o site ou trocar de aparelho.
 * Le so process.env porque `cloudflare:workers` nao carrega fora do workerd,
 * e com nodejs_compat as secrets do Worker aparecem em process.env do mesmo jeito.
 */
export function chaveDoServidor() {
  const bruta = typeof process !== 'undefined' && process.env
    ? process.env.ELEVENLABS_API_KEY
    : '';
  const key = String(bruta || '').trim();
  return FORMATO.test(key) ? key : '';
}

export function temChaveDoServidor() {
  return !!chaveDoServidor();
}

/**
 * Usa a chave que o navegador mandou; se nao veio nenhuma, cai na do servidor.
 * Quem ja salvou a sua continua mandando a dele; quem nunca salvou tambem tem voz.
 */
export function resolverChave(value: unknown, contexto = 'para usar a voz natural') {
  const key = String(value || '').trim();
  if (!key) {
    const doServidor = chaveDoServidor();
    if (doServidor) return doServidor;
    throw new Error('Cole uma chave valida da ElevenLabs ' + contexto + '.');
  }
  if (key.length < 12) throw new Error('Cole uma chave valida da ElevenLabs ' + contexto + '.');
  if (!FORMATO.test(key)) {
    throw new Error('A chave da ElevenLabs precisa comecar com sk_. Voce colou o ID da chave, nao a chave real.');
  }
  return key;
}
