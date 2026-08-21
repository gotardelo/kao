declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env & {
    KAO_DB?: D1Database;
    KAO_VAULT_SECRET?: string;
  };
}
