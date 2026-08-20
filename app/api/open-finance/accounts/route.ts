import { assertOwnedItem, body, errorResponse, pluggy } from '../_pluggy';

export async function POST(request: Request) {
  try {
    const input = await body(request);
    const itemId = String(input.itemId || '');
    const clientUserId = String(input.clientUserId || '');
    await assertOwnedItem(itemId, clientUserId);
    const page = await pluggy(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    const entries = Array.isArray(page.results) ? page.results : Array.isArray(page.accounts) ? page.accounts : [];
    const contas = entries.map((entry: any) => ({
      id: entry.id, name: entry.name, marketingName: entry.marketingName,
      institution: entry.institution?.name || entry.connector?.name || '', type: entry.type,
      subtype: entry.subtype, balance: entry.balance, currencyCode: entry.currencyCode, number: entry.number,
    }));
    return Response.json({ contas });
  } catch (error) {
    return errorResponse(error);
  }
}
