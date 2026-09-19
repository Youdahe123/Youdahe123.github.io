import { json, methodNotAllowed, badRequest } from '../lib/respond.js';
import { readJSON, writeJSON } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';

const MAX_TITLE_LEN = 300;
const MAX_CONTENT_LEN = 200_000;
const MAX_PREVIEW_LEN = 500;

function isValidId(id) {
  return typeof id === 'string' && /^[a-z0-9]+$/i.test(id) && id.length <= 24;
}

export default async function handler(request, env) {
  if (request.method === 'GET') {
    const posts = await readJSON(env, 'posts.json', []);
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));
    return json(posts);
  }

  const denied = await requireAuth(request, env);
  if (denied) return denied;

  if (request.method === 'POST') {
    const { title, content, preview, date } = await request.json().catch(() => ({}));

    if (!title || !content) {
      return badRequest('title and content required');
    }

    const posts = await readJSON(env, 'posts.json', []);
    const safeContent = String(content).slice(0, MAX_CONTENT_LEN);

    const post = {
      id: Date.now().toString(36),
      title: String(title).slice(0, MAX_TITLE_LEN),
      content: safeContent,
      preview: preview ? String(preview).slice(0, MAX_PREVIEW_LEN) : safeContent.slice(0, 200),
      date: date || new Date().toISOString(),
    };

    posts.push(post);
    await writeJSON(env, 'posts.json', posts);

    return json(post, 201);
  }

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!isValidId(id)) return badRequest('invalid id');

    const posts = await readJSON(env, 'posts.json', []);
    await writeJSON(env, 'posts.json', posts.filter((p) => p.id !== id));

    return json({ deleted: id });
  }

  return methodNotAllowed();
}
