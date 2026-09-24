import { json, methodNotAllowed } from '../lib/respond.js';
import { readJSON, writeJSON } from '../lib/store.js';

// The tally lives in DATA next to the rest of the site content. There is no
// data/highfives.json seed on purpose: `npm run seed` overwrites every key it
// finds a file for, and a re-seed must never reset a live count. A namespace
// that has never been written falls through to the default below.
const KEY = 'highfives.json';

// One person counts once a year. Long enough that the number means "people",
// short enough that the dedupe keys expire instead of accumulating forever.
const VISITOR_TTL_S = 365 * 24 * 60 * 60;

// A single address can only add so many new high fives in a day, so the number
// stays worth showing even if someone decides to script it. Set well above what
// one person does and well below what would move the count: a campus or an
// office behind one address is a crowd of real people, not an attack.
const IP_WINDOW_S = 24 * 60 * 60;
const IP_MAX_NEW = 25;

// Identify a visitor without writing down anything that identifies them: the
// address and user agent go in, a truncated digest comes out, and the digest is
// the only thing that is ever stored.
async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

async function visitorKey(request) {
  const ua = request.headers.get('user-agent') || 'unknown';
  return `hf:${await digest(`${clientIp(request)}|${ua}`)}`;
}

async function addressKey(request) {
  return `hf-ip:${await digest(clientIp(request))}`;
}

async function readCount(env) {
  const stored = await readJSON(env, KEY, { count: 0 });
  return Number(stored?.count) || 0;
}

export default async function handler(request, env) {
  // The dedupe markers are short-lived, high-churn keys, so they go in
  // SESSIONS rather than alongside durable content in DATA.
  const seenKey = await visitorKey(request);

  if (request.method === 'GET') {
    const [count, seen] = await Promise.all([readCount(env), env.SESSIONS.get(seenKey)]);
    // Never cached: the point of the badge is that it is current, and the
    // "you" flag is per visitor.
    return json({ count, you: seen !== null }, 200, { 'cache-control': 'no-store' });
  }

  if (request.method !== 'POST') return methodNotAllowed();

  const count = await readCount(env);
  if (await env.SESSIONS.get(seenKey)) {
    return json({ count, you: true, counted: false }, 200, { 'cache-control': 'no-store' });
  }

  const ipKey = await addressKey(request);
  const fromAddress = Number(await env.SESSIONS.get(ipKey)) || 0;
  if (fromAddress >= IP_MAX_NEW) {
    // Quietly decline rather than erroring: the widget has nothing useful to
    // say about a rate limit, and a real person will never see this.
    return json({ count, you: true, counted: false }, 200, { 'cache-control': 'no-store' });
  }

  // Read, add one, write back. KV has no atomic increment, so two clicks in the
  // same instant can land on the same number. At this site's traffic that is a
  // rounding error on a decorative counter, and the alternative is a Durable
  // Object for something nobody audits.
  const next = count + 1;
  await Promise.all([
    writeJSON(env, KEY, { count: next }),
    env.SESSIONS.put(seenKey, '1', { expirationTtl: VISITOR_TTL_S }),
    env.SESSIONS.put(ipKey, String(fromAddress + 1), { expirationTtl: IP_WINDOW_S }),
  ]);

  return json({ count: next, you: true, counted: true }, 200, { 'cache-control': 'no-store' });
}
