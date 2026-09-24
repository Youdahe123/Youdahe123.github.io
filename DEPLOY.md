# Deploying youdahe.com on Cloudflare

The site runs as a single Cloudflare Worker. Static files are served from the
edge; `/api/*` runs Worker code backed by KV, and image uploads live in R2.
GitHub Pages is no longer involved.

```
request ──> Worker
             ├── /api/*            routes in worker/routes/, data in KV
             ├── /images/uploads/* R2 bucket
             ├── /admin, /daily,   session-gated, else redirect to /admin-portal
             │   /notion-prep
             └── everything else   static assets from _site/
```

## One-time setup

Steps 1 to 6 need your Cloudflare account. Run them in order.

### 1. Install and sign in

```bash
npm install
npx wrangler login
```

### 2. Register the domain

In the Cloudflare dashboard: **Domain Registration > Register Domains**, search
`youdahe.com`, and buy it. Cloudflare sells at cost, roughly $10 a year for a
`.com`, and the zone plus nameservers are configured for you. Nothing to do in
DNS by hand.

If you would rather buy elsewhere, add the domain as a zone under **Websites >
Add a site** and point the registrar's nameservers at the two Cloudflare gives
you, then wait for the zone to go active.

### 3. Create the KV namespaces

```bash
npx wrangler kv namespace create DATA
npx wrangler kv namespace create SESSIONS
```

Each prints an `id`. Paste them into `wrangler.toml`, replacing
`REPLACE_WITH_DATA_NAMESPACE_ID` and `REPLACE_WITH_SESSIONS_NAMESPACE_ID`.

### 4. Create the R2 bucket

```bash
npx wrangler r2 bucket create youdahe-uploads
```

R2 needs to be enabled once in the dashboard under **R2 > Overview**, which
asks for a payment method even though the free tier covers 10 GB. If you skip
this, everything else still works and `/api/upload` returns a clear 503.

### 5. Set the admin password

```bash
npx wrangler secret put ADMIN_PASSWORD
```

This is the password for `/admin-portal`. It is the only thing standing between
the public internet and your content, so make it long and random. It is stored
encrypted by Cloudflare and never appears in the repo.

### 6. Deploy and seed

```bash
npm run deploy   # builds _site/ and pushes the Worker
npm run seed     # copies data/*.json into KV
```

Run `npm run seed` once, at first deploy. After that KV is the source of truth
and re-running it would overwrite live content with whatever is committed.

The high five count is deliberately not in `data/`, so a re-seed can never
reset it. `highfives.json` is created in the DATA namespace by the first
person who taps the photo, and a namespace without it reads as zero.

### 7. Attach the domain

In the dashboard: **Workers & Pages > youdahe-com > Settings > Domains &
Routes > Add > Custom domain**. Add `youdahe.com` and then `www.youdahe.com`.
Cloudflare creates the DNS records and issues the certificate, usually within a
couple of minutes.

## Everyday use

```bash
npm run dev      # local server at http://localhost:8787, local KV and R2
npm run deploy   # build and ship
npm run tail     # stream live production logs
```

For `npm run dev`, copy `.dev.vars.example` to `.dev.vars` and set a throwaway
`ADMIN_PASSWORD`. Local KV and R2 state lives in `.wrangler/` and is not shared
with production.

Publishing a post no longer needs a commit and a redeploy. Sign in at
`/admin-portal`, write, and it is live: the admin page writes to KV and the
public pages read from the same place.

## What is gated

| Path | Anonymous |
|---|---|
| `GET /api/posts`, `/api/status`, `/api/photos` | allowed, the public site reads these |
| `GET`/`POST /api/highfive` | allowed, the landing page widget writes the count |
| `POST`/`DELETE` on any `/api/*` | 401 |
| `/api/daily`, `/api/notes`, all methods | 401, these are private journals |
| `/admin`, `/daily`, `/notion-prep` | redirected to `/admin-portal` |

The page gate is enforced in the Worker, not in page JavaScript, so viewing
source or disabling JS does not get past it. Login is rate limited to 5 attempts
per IP per minute, and sessions expire after 2 hours.

`data/daily.json` and `data/notes.json` are deliberately excluded from the
static build by `scripts/build.sh`. A file in `_site/` is readable by anyone,
and the `/api` gate would not cover it, so those two exist only in KV.

## Rolling back

```bash
npx wrangler deployments list
npx wrangler rollback [deployment-id]
```

KV content is not covered by a rollback. To snapshot it before a risky change:

```bash
for k in posts.json status.json photos.json daily.json notes.json; do
  npx wrangler kv key get "$k" --binding DATA --remote > "backup-$k"
done
```
