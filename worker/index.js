import { json } from './lib/respond.js';
import { isAuthenticated } from './lib/auth.js';
import adminAuth from './routes/admin-auth.js';
import aim from './routes/aim.js';
import daily from './routes/daily.js';
import highfive from './routes/highfive.js';
import notes from './routes/notes.js';
import photos from './routes/photos.js';
import posts from './routes/posts.js';
import stars from './routes/stars.js';
import status from './routes/status.js';
import upload, { UPLOAD_PREFIX, serveUpload } from './routes/upload.js';

const ROUTES = {
  '/api/admin-auth': adminAuth,
  '/api/aim': aim,
  '/api/daily': daily,
  '/api/highfive': highfive,
  '/api/notes': notes,
  '/api/photos': photos,
  '/api/posts': posts,
  '/api/stars': stars,
  '/api/status': status,
  '/api/upload': upload,
};

// Admin tooling. These ship in the build so they work from anywhere, but the
// Worker refuses to serve them without a session, so the gate cannot be
// bypassed by disabling JavaScript or reading the page source.
const PRIVATE_PAGES = new Set([
  '/admin',
  '/admin.html',
  '/daily',
  '/daily.html',
  '/notion-prep',
  '/notion-prep.html',
]);

function normalize(pathname) {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = normalize(url.pathname);

    if (path.startsWith('/api/')) {
      const route = ROUTES[path];
      if (!route) return json({ error: 'not found' }, 404);

      try {
        return await route(request, env, ctx);
      } catch (error) {
        console.error(`API error on ${path}:`, error);
        return json({ error: 'internal server error' }, 500);
      }
    }

    if (path.startsWith(UPLOAD_PREFIX)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405 });
      }
      return serveUpload(request, env, path.slice(UPLOAD_PREFIX.length));
    }

    if (PRIVATE_PAGES.has(path) && !(await isAuthenticated(request, env))) {
      // The asset server strips .html, so point straight at the final URL.
      return Response.redirect(new URL('/admin-portal', url.origin), 302);
    }

    return env.ASSETS.fetch(request);
  },
};
