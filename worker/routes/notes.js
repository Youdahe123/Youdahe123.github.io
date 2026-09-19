import { json, methodNotAllowed, badRequest } from '../lib/respond.js';
import { readJSON, writeJSON } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';

const VALID_TAGS = new Set(['general', 'goals', 'learning', 'objectives', 'ideas']);
const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 50_000;

function isValidId(id) {
  return typeof id === 'string' && /^[a-z0-9]+$/i.test(id) && id.length <= 24;
}

// Notes are private, same as the daily log: gated on every method.
export default async function handler(request, env) {
  const denied = await requireAuth(request, env);
  if (denied) return denied;

  if (request.method === 'GET') {
    const notes = await readJSON(env, 'notes.json', []);
    notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return json(notes);
  }

  if (request.method === 'POST') {
    const { id, title, body, tag } = await request.json().catch(() => ({}));

    if (id !== undefined && !isValidId(id)) return badRequest('invalid id');

    const notes = await readJSON(env, 'notes.json', []);
    const now = new Date().toISOString();
    const noteId = id || Date.now().toString(36);
    const existing = notes.find((n) => n.id === noteId);

    const note = {
      id: noteId,
      title: typeof title === 'string' ? title.slice(0, MAX_TITLE_LEN) : '',
      body: typeof body === 'string' ? body.slice(0, MAX_BODY_LEN) : '',
      tag: VALID_TAGS.has(tag) ? tag : 'general',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const next = notes.filter((n) => n.id !== noteId);
    next.push(note);
    await writeJSON(env, 'notes.json', next);

    return json(note, 201);
  }

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!isValidId(id)) return badRequest('invalid id');

    const notes = await readJSON(env, 'notes.json', []);
    await writeJSON(env, 'notes.json', notes.filter((n) => n.id !== id));

    return json({ deleted: id });
  }

  return methodNotAllowed();
}
