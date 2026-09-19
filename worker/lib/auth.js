import { json } from './respond.js';

export const COOKIE_NAME = 'admin_session';

const SESSION_TTL_S = 2 * 60 * 60; // 2 hours
const MAX_ATTEMPTS = 5;
const LOCKOUT_S = 60;

export function getCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

// Compare fixed-length digests so neither the outcome nor the timing depends
// on the length or content of the submitted password.
async function safeCompare(a, b) {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(a))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(b))),
  ]);

  const viewA = new Uint8Array(digestA);
  const viewB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < viewA.length; i++) diff |= viewA[i] ^ viewB[i];
  return diff === 0;
}

export async function isAuthenticated(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  return (await env.SESSIONS.get(`session:${token}`)) !== null;
}

// Wraps a handler so it only runs for a signed-in operator. Returns 401 rather
// than redirecting, since every caller is fetch() from an admin page.
export async function requireAuth(request, env) {
  if (await isAuthenticated(request, env)) return null;
  return json({ error: 'unauthorized' }, 401);
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

export async function isLockedOut(request, env) {
  const raw = await env.SESSIONS.get(`lockout:${clientIp(request)}`);
  return raw !== null && Number(raw) >= MAX_ATTEMPTS;
}

async function recordFailure(request, env) {
  const key = `lockout:${clientIp(request)}`;
  const count = Number((await env.SESSIONS.get(key)) || 0) + 1;
  await env.SESSIONS.put(key, String(count), { expirationTtl: LOCKOUT_S });
}

async function clearFailures(request, env) {
  await env.SESSIONS.delete(`lockout:${clientIp(request)}`);
}

export async function login(request, env, password) {
  const configured = env.ADMIN_PASSWORD;
  if (!configured) return { ok: false, status: 500, error: 'admin auth not configured' };

  const valid =
    typeof password === 'string' &&
    password.length <= 200 &&
    (await safeCompare(password, configured));

  if (!valid) {
    await recordFailure(request, env);
    return { ok: false, status: 401, error: 'invalid credentials' };
  }

  await clearFailures(request, env);

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.SESSIONS.put(`session:${token}`, '1', { expirationTtl: SESSION_TTL_S });

  return { ok: true, cookie: sessionCookie(token, SESSION_TTL_S) };
}

export async function logout(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (token) await env.SESSIONS.delete(`session:${token}`);
  return sessionCookie('', 0);
}

function sessionCookie(token, maxAge) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
