import { temChaveDoServidor } from '../chave';

/** O app pergunta aqui se ja existe chave salva no servidor antes de pedir uma. */
export async function GET() {
  return Response.json(
    { serverKey: temChaveDoServidor() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
