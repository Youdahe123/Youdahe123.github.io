import { json, methodNotAllowed, badRequest } from '../lib/respond.js';
import { readJSON, writeJSON } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';

const DEFAULT_STATUS = 'open to chatting about systems and startups';

export default async function handler(request, env) {
  if (request.method === 'GET') {
    return json(await readJSON(env, 'status.json', { text: DEFAULT_STATUS }));
  }

  if (request.method === 'POST') {
    const denied = await requireAuth(request, env);
    if (denied) return denied;

    const { text } = await request.json().catch(() => ({}));
    if (!text || typeof text !== 'string' || text.length > 200) {
      return badRequest('invalid status text');
    }

    const trimmed = text.trim();
    await writeJSON(env, 'status.json', { text: trimmed });
    return json({ text: trimmed });
  }

  return methodNotAllowed();
}
