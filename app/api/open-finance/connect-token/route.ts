import { body, errorResponse, pluggy } from '../_pluggy';

export async function POST(request: Request) {
  try {
    const input = await body(request);
    const clientUserId = String(input.clientUserId || '');
    if (!/^kao-[0-9a-z-]{12,}$/i.test(clientUserId)) throw new Error('Conta do app invalida.');
    const token = await pluggy('/connect_token', {
      method: 'POST',
      body: JSON.stringify({ options: { clientUserId, avoidDuplicates: true } }),
    });
    return Response.json({ accessToken: String(token.accessToken || '') });
  } catch (error) {
    return errorResponse(error);
  }
}
