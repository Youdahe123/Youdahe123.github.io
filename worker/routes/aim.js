import { isAuthenticated } from '../lib/auth.js';
import { badRequest, json, methodNotAllowed } from '../lib/respond.js';
import { readJSON, writeJSON } from '../lib/store.js';

// Like the high five count, the board has no data/ seed on purpose, so a
// re-seed can never wipe it. A namespace that has never been written reads as
// an empty board.
const KEY = 'aimscores.json';

// Only the top of the board is kept. Anything below it would never be shown,
// and a bounded list keeps every read and write the same small size.
const KEEP = 50;
const SHOW = 20;

// A 30 second round with five targets up at once. A very good player clears a
// little over two a second, so anything past this did not come from the game.
const MAX_HITS = 120;
const MAX_SHOTS = 600;
const NAME_MAX = 20;

// The guns aim.js offers. Anything else is stored as the default.
const GUNS = new Set(['plasma', 'ar', 'ak', 'pistol', 'deagle', 'revolver', 'awp', 'shotgun', 'smg']);

// Saves per address per hour. Enough for someone grinding their own score,
// not enough to flood the board with names.
const IP_WINDOW_S = 60 * 60;
const IP_MAX_SAVES = 12;

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function addressKey(request) {
  return `aim-ip:${await digest(request.headers.get('cf-connecting-ip') || 'unknown')}`;
}

// Letters, numbers, spaces and a little punctuation. Control characters and
// markup never make it to the board, and runs of spaces collapse to one.
function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} ._\-'!?]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

// Best first; on a tie the more accurate run wins, then whoever got there first.
function rank(a, b) {
  return b.score - a.score || a.shots - b.shots || a.at - b.at;
}

function view(entry) {
  const { id, name, score, shots, gun, reload, at } = entry;
  return {
    id,
    name,
    score,
    accuracy: shots ? Math.round((score / shots) * 100) : 100,
    gun: gun || 'plasma',
    reload: reload !== false,
    at,
  };
}

async function readBoard(env) {
  const stored = await env.DATA.get(KEY, 'json');
  return Array.isArray(stored) ? stored : [];
}

export default async function handler(request, env) {
  if (request.method === 'GET') {
    const board = await readBoard(env);
    return json({ scores: board.slice(0, SHOW).map(view) }, 200, { 'cache-control': 'no-store' });
  }

  if (request.method === 'DELETE') {
    // Moderation: drop one entry by id, for a name that should not be there.
    if (!(await isAuthenticated(request, env))) return json({ error: 'unauthorized' }, 401);
    const id = new URL(request.url).searchParams.get('id');
    const board = await readBoard(env);
    await writeJSON(env, KEY, board.filter((entry) => entry.id !== id));
    return json({ ok: true });
  }

  if (request.method !== 'POST') return methodNotAllowed();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('expected json');
  }

  const name = cleanName(body?.name);
  const score = Number(body?.score);
  const shots = Number(body?.shots);
  if (!name) return badRequest('name required');
  if (!Number.isInteger(score) || score < 1 || score > MAX_HITS) return badRequest('bad score');
  if (!Number.isInteger(shots) || shots < score || shots > MAX_SHOTS) return badRequest('bad shots');

  const ipKey = await addressKey(request);
  const fromAddress = Number(await env.SESSIONS.get(ipKey)) || 0;
  if (fromAddress >= IP_MAX_SAVES) {
    return json({ error: 'too many saves, try again in a bit' }, 429);
  }

  // Read, insert, trim, write. Same trade as the high five count: KV has no
  // transactions, and two saves in the same instant losing one is acceptable
  // for a game on a personal site.
  const gun = GUNS.has(body?.gun) ? body.gun : 'plasma';
  // Whether the run had reloading on. Missing means on, the harder default.
  const reload = body?.reload !== false;
  const entry = { id: crypto.randomUUID().slice(0, 8), name, score, shots, gun, reload, at: Date.now() };
  const board = [...(await readBoard(env)), entry].sort(rank).slice(0, KEEP);
  await Promise.all([
    writeJSON(env, KEY, board),
    env.SESSIONS.put(ipKey, String(fromAddress + 1), { expirationTtl: IP_WINDOW_S }),
  ]);

  const place = board.findIndex((e) => e.id === entry.id);
  return json(
    {
      id: entry.id,
      place: place === -1 ? null : place + 1,
      scores: board.slice(0, SHOW).map(view),
    },
    200,
    { 'cache-control': 'no-store' }
  );
}
