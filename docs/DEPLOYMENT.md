# Deploying CV GADGETS

The app is a single Node.js process that serves the website, admin and API, plus MongoDB. Pick one of the options below. Whichever you choose:

- The site **must be served over HTTPS** in production (session cookies are `Secure`, and payment providers require HTTPS webhooks).
- Set `NODE_ENV=production`, `APP_URL=https://your-domain`, a strong `JWT_SECRET` (32+ chars), and `TRUST_PROXY=1` when behind a proxy.

## Option A: VPS (Ubuntu) with Nginx and PM2 (recommended for Nigerian traffic)

Choose a server close to your customers (e.g. a South Africa or Europe region, or a Nigerian host) and use a managed MongoDB (Atlas) or install MongoDB yourself.

```bash
# 1. Install Node 22 and PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx
sudo npm i -g pm2

# 2. Get the code and install
git clone <your-repo> /var/www/cv-gadgets && cd /var/www/cv-gadgets
npm ci --omit=dev
cp .env.example .env && nano .env        # fill in the values
npm run seed                             # base data + admin (do NOT run seed:demo on a live store)

# 3. Run it
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup                  # restart on reboot
```

**Nginx** (`/etc/nginx/sites-available/cv-gadgets`):

```nginx
server {
  server_name www.your-domain.ng your-domain.ng;
  client_max_body_size 25m;                 # product image uploads
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cv-gadgets /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.ng -d www.your-domain.ng
```

Uploaded images live in `uploads/` on the server. Back that folder up, or use Cloudinary (`CLOUDINARY_*` variables) so images survive server rebuilds.

## Option B: Docker

```bash
cp .env.example .env && nano .env
docker compose up -d --build
docker compose exec web node server/scripts/seed.js
```

Put Nginx/Caddy/Traefik in front for HTTPS. Volumes keep the database and uploads.

## Option C: Render / Railway / similar

1. Create a MongoDB Atlas cluster (free tier is fine to start) and allow the host's IPs.
2. Create a Web Service from the repo: build `npm ci --omit=dev`, start `npm start`.
3. Add every variable from `.env.example` as environment variables, set `TRUST_PROXY=1`.
4. **Persistent images:** these platforms have ephemeral disks. Use Cloudinary (`CLOUDINARY_*`) or attach a persistent disk and point `UPLOAD_DIR` at it.
5. Run `npm run seed` once from the platform's shell.

## Option D: Vercel (API with a separately hosted storefront)

The root `index.js` exports the Express app for Vercel Functions and connects to MongoDB on demand. This deployment serves the API only; host the storefront separately. Do not select the Dockerfile builder for this project.

1. Push the changes to GitHub. In Vercel, import this repository and set **Root Directory** to the repository root and **Framework Preset** to **Express**. Leave the Build Command and Output Directory at their defaults.
2. Add these environment variables to the Vercel project (Production and Preview as needed):
   - `NODE_ENV=production`
   - `MONGO_URI` — MongoDB Atlas connection string; allow Vercel network access in Atlas.
   - `JWT_SECRET` — a new random secret of at least 32 characters.
   - `APP_URL` — the deployed backend URL. Payment webhook URLs are based on this value.
   - `STOREFRONT_URL` — the public storefront URL used for payment returns and customer email links.
   - `ALLOWED_ORIGINS=https://cvgadgets.vercel.app` — exact storefront origin, including `https://` and no trailing slash. Comma-separate any additional origins. The legacy `FRONTEND_ORIGINS` name is also accepted.
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` — use a strong, new admin password.
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` for product image uploads. Vercel's filesystem is not persistent; do not rely on local `uploads/`.
   - Add payment and SMTP secrets only when those services are configured.
3. Deploy, then test `https://YOUR-BACKEND.vercel.app/healthz` and `https://YOUR-BACKEND.vercel.app/api/config`.
4. Configure the storefront to send API requests to the backend and include credentials for session cookies. For reliable cookie login, use a custom domain and keep the storefront and API on the same site, or proxy `/api/*` through the storefront domain; separate `*.vercel.app` domains may be treated as third-party cookies by browsers.
5. Update Paystack/Flutterwave webhook URLs to `https://YOUR-BACKEND.vercel.app/api/webhooks/paystack` and `/api/webhooks/flutterwave`.

Vercel Functions do not keep the `server/index.js` interval alive, so the expired-order stock sweeper must be run through a scheduled job before relying on order expiry. Uploaded images must use Cloudinary or another persistent object store.

## After deployment

- Add the **webhook URLs** to Paystack and Flutterwave (see README).
- Visit `https://your-domain/admin`, sign in, and complete the go-live checklist in the README.
- Health check: `GET /healthz` returns `{"ok":true}`.
- The server shuts down gracefully on SIGTERM and a background job releases stock held by expired unpaid orders every minute (run a single instance, or move this job to a scheduler if you scale out).

## Backups

```bash
mongodump --uri "$MONGO_URI" --gzip --archive=cv-gadgets-$(date +%F).gz     # daily via cron
mongorestore --uri "$MONGO_URI" --gzip --archive=cv-gadgets-2026-01-01.gz   # restore
tar czf uploads-$(date +%F).tgz uploads                                      # if storing images on disk
```

Atlas paid tiers include automated backups.

## Updating

```bash
git pull && npm ci --omit=dev && pm2 restart cv-gadgets
```

Indexes are applied automatically at startup; `npm run seed` is safe to re-run and never overwrites your edits.

## Scaling notes

- Product search uses indexed regex matching, which is fine for thousands of products. For very large catalogues move to MongoDB Atlas Search.
- Sessions are stateless JWT cookies, so you can run multiple instances behind a load balancer. Keep the expiry job on one instance.
