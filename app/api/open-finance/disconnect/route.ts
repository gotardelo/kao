import { assertOwnedItem, body, errorResponse, pluggy } from '../_pluggy';

export async function POST(request: Request) {
  try {
    const input = await body(request);
    const itemId = String(input.itemId || '');
    const clientUserId = String(input.clientUserId || '');
    await assertOwnedItem(itemId, clientUserId);
    await pluggy(`/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
