import { json, methodNotAllowed } from '../lib/respond.js';

const REPO = 'Youdahe123/youdaheDB';
const TTL = 3600;

export default async function handler(request, env, ctx) {
  if (request.method !== 'GET') return methodNotAllowed();

  // GitHub allows 60 unauthenticated calls an hour per IP, and every visitor
  // shares the Worker's. Caching the answer at the edge keeps that to one call
  // an hour no matter how much traffic the page gets.
  const cache = caches.default;
  const key = new Request(`https://stars.youdahe.com/${REPO}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const upstream = await fetch(`https://api.github.com/repos/${REPO}`, {
    headers: {
      accept: 'application/vnd.github+json',
      // GitHub rejects API requests that do not identify themselves.
      'user-agent': 'youdahe.com',
    },
  });

  if (!upstream.ok) {
    // The count is decoration, so a bad hour upstream must not surface as a
    // broken page: the client hides the badge when this is not a 200.
    return json({ error: 'upstream unavailable' }, 502);
  }

  const { stargazers_count: stars } = await upstream.json();
  if (typeof stars !== 'number') return json({ error: 'upstream unavailable' }, 502);

  const response = json({ repo: REPO, stars }, 200, {
    'cache-control': `public, max-age=${TTL}`,
  });
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}
