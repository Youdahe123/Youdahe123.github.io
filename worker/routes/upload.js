import { json, methodNotAllowed, badRequest } from '../lib/respond.js';
import { requireAuth } from '../lib/auth.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export const UPLOAD_PREFIX = '/images/uploads/';

export default async function handler(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();

  const denied = await requireAuth(request, env);
  if (denied) return denied;

  if (!env.UPLOADS) {
    return json({ error: 'uploads bucket not configured' }, 503);
  }

  const rawType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(rawType)) {
    return badRequest('unsupported file type');
  }

  // Reject on the declared size before buffering, then again on the real size,
  // since content-length is client-supplied.
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_SIZE) {
    return json({ error: 'file too large (max 5 MB)' }, 413);
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_SIZE) {
    return json({ error: 'file too large (max 5 MB)' }, 413);
  }

  const rawName = request.headers.get('x-filename') || `image-${Date.now()}`;
  const filename = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 80);
  const key = `${Date.now()}-${filename}`;

  await env.UPLOADS.put(key, buffer, { httpMetadata: { contentType: rawType } });

  return json({ url: `${UPLOAD_PREFIX}${key}` });
}

// Uploaded images live in R2, not in the static build, so the Worker serves
// them. They are immutable once written, hence the long cache lifetime.
export async function serveUpload(request, env, key) {
  if (!env.UPLOADS) return new Response('not found', { status: 404 });

  const object = await env.UPLOADS.get(key);
  if (!object) return new Response('not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
}
