import { configured } from '../_pluggy';

export async function POST() {
  return Response.json({ configurado: configured() });
}
