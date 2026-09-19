import { json, methodNotAllowed, badRequest } from '../lib/respond.js';
import { readJSON, writeJSON } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';

const MAX_URL_LEN = 500;

function isValidId(id) {
  return typeof id === 'string' && /^[a-z0-9]+$/i.test(id) && id.length <= 24;
}

export default async function handler(request, env) {
  if (request.method === 'GET') {
    const photos = await readJSON(env, 'photos.json', []);
    photos.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    return json(photos);
  }

  const denied = await requireAuth(request, env);
  if (denied) return denied;

  if (request.method === 'POST') {
    const { url } = await request.json().catch(() => ({}));
    if (!url || typeof url !== 'string' || url.length > MAX_URL_LEN) {
      return badRequest('invalid url');
    }

    const photos = await readJSON(env, 'photos.json', []);
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const entry = {
      id: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''),
      url,
      addedAt: new Date().toISOString(),
    };

    photos.push(entry);
    await writeJSON(env, 'photos.json', photos);

    return json(entry);
  }

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!isValidId(id)) return badRequest('invalid id');

    const photos = await readJSON(env, 'photos.json', []);
    const next = photos.filter((p) => p.id !== id);
    if (next.length === photos.length) return json({ error: 'not found' }, 404);

    await writeJSON(env, 'photos.json', next);
    return json({ ok: true });
  }

  return methodNotAllowed();
}
