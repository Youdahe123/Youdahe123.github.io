import { json, methodNotAllowed, badRequest } from '../lib/respond.js';
import { readJSON, writeJSON } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';

const MAX_FIELD_LEN = 20_000;

const FIELDS = [
  'libertyMutual',
  'medica',
  'neetcode',
  'youdaheDB',
  'containerRuntime',
  'sysDesign',
  'startup',
  'wins',
  'blockers',
];

function isValidId(id) {
  return typeof id === 'string' && /^[a-z0-9]+$/i.test(id) && id.length <= 24;
}

function sanitizeField(v) {
  if (typeof v !== 'string') return '';
  return v.slice(0, MAX_FIELD_LEN);
}

// The daily log is a private journal, so every method is gated, reads included.
export default async function handler(request, env) {
  const denied = await requireAuth(request, env);
  if (denied) return denied;

  if (request.method === 'GET') {
    const logs = await readJSON(env, 'daily.json', []);
    logs.sort((a, b) => new Date(b.date) - new Date(a.date));
    return json(logs);
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const logs = await readJSON(env, 'daily.json', []);

    const log = { id: Date.now().toString(36), date: body.date || new Date().toISOString() };
    for (const field of FIELDS) log[field] = sanitizeField(body[field]);

    logs.push(log);
    await writeJSON(env, 'daily.json', logs);

    return json(log, 201);
  }

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!isValidId(id)) return badRequest('invalid id');

    const logs = await readJSON(env, 'daily.json', []);
    await writeJSON(env, 'daily.json', logs.filter((l) => l.id !== id));

    return json({ deleted: id });
  }

  return methodNotAllowed();
}
