import { json, methodNotAllowed } from '../lib/respond.js';
import { isAuthenticated, isLockedOut, login, logout } from '../lib/auth.js';

export default async function handler(request, env) {
  if (request.method === 'GET') {
    return json({ authenticated: await isAuthenticated(request, env) });
  }

  if (request.method === 'POST') {
    if (await isLockedOut(request, env)) {
      return json({ error: 'too many attempts, try again shortly' }, 429);
    }

    const body = await request.json().catch(() => ({}));
    const result = await login(request, env, body.password);

    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true }, 200, { 'set-cookie': result.cookie });
  }

  if (request.method === 'DELETE') {
    const cookie = await logout(request, env);
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  return methodNotAllowed();
}
