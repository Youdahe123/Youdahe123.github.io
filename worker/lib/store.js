// KV is the source of truth for site content. The committed data/*.json files
// are the seed: `npm run seed` pushes them up, and a key that has never been
// written falls back to the copy bundled with the static build, so a fresh
// namespace serves the same content the old GitHub Pages build did.
export async function readJSON(env, name, fallback) {
  const stored = await env.DATA.get(name, 'json');
  if (stored !== null && stored !== undefined) return stored;

  try {
    const res = await env.ASSETS.fetch(new URL(`/data/${name}`, 'https://assets.local'));
    if (res.ok) return await res.json();
  } catch {
    // fall through to the caller's default
  }

  return fallback;
}

export async function writeJSON(env, name, value) {
  await env.DATA.put(name, JSON.stringify(value));
}
