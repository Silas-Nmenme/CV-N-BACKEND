# CV GADGETS — Vercel deployment fixes

## What changed

- Frontend rewrites now proxy `/api/*` and `/uploads/*` to `https://cv-n-backend.vercel.app`.
- `/p/:slug` is rewritten to the backend so the backend can insert product SEO/Open Graph/JSON-LD tags before returning `product.html`.
- Existing clean storefront routes continue to map to their HTML files.
- `afterSignIn()` no longer blocks navigation to `/account` (or `/admin` for staff) if optional cart/wishlist synchronization fails.
- Backend Vercel entry point remains a serverless Express export with MongoDB connection reuse.
- Added `/api/cron/expire-orders`, protected by `CRON_SECRET`, and a Vercel Cron schedule every five minutes.
- Added serverless access to `/uploads/*` for bundled/legacy files. New production uploads now fail clearly unless Cloudinary is configured; Vercel's local filesystem is not persistent.
- Kept session cookies `HttpOnly`, `Secure` in production and `SameSite=Lax`. This is intentional because the browser calls the frontend domain and Vercel proxies the API on the same origin. Do not switch to `SameSite=None` for this same-origin proxy setup.

## Vercel project settings

### Backend project

- Repository: this project
- Root Directory: repository root (`.`)
- Framework: Express / Other (depending on Vercel's current detection)
- Build Command: leave default/blank
- Output Directory: leave default/blank
- Install Command: `npm install` (or leave the default)

Set these environment variables in Production (and Preview if you deploy previews):

Required:
- `NODE_ENV` = `production`
- `MONGO_URI` = your MongoDB Atlas connection string
- `JWT_SECRET` = a new random secret, at least 32 characters
- `APP_URL` = `https://cv-n-backend.vercel.app`
- `STOREFRONT_URL` = `https://cvgadgets.vercel.app`
- `ALLOWED_ORIGINS` = `https://cvgadgets.vercel.app`
- `CRON_SECRET` = a long random secret; keep it private

Required for production product image uploads:
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Optional, depending on enabled features:
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (use only for first admin creation; use a strong password)
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_PUBLIC_KEY`
- `FLW_SECRET_KEY`
- `FLW_PUBLIC_KEY`
- `FLW_SECRET_HASH`
- `SMTP_HOST`
- `SMTP_PORT` (normally `587`)
- `SMTP_SECURE` (normally `false` for port 587)
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`
- `JWT_EXPIRES_DAYS` (defaults to 14)
- `TRUST_PROXY` (defaults to 1 in production)
- `PENDING_ORDER_MINUTES` (defaults to 60)
- `BANK_TRANSFER_HOLD_HOURS` (defaults to 24)

Do not set `UPLOAD_DIR` to rely on local persistent uploads on Vercel. Cloudinary is required for new product image uploads.

### Frontend project

- Repository: same repository
- Root Directory: `frontend`
- Framework: Other / Static
- Build Command: leave blank
- Output Directory: leave blank (serve the `frontend` directory itself)
- No environment variables are required with the current `api-config.js`; it uses the same-origin Vercel rewrites in production and the backend origin for local/preview hosts.

If you later use a custom storefront domain, update:
1. `frontend/assets/js/core/api-config.js` production hostname check;
2. `frontend/vercel.json` (if the API destination changes);
3. backend `ALLOWED_ORIGINS` and `STOREFRONT_URL`.

## Deploy and verify

1. Deploy the backend project first.
2. Check `https://cv-n-backend.vercel.app/healthz` — expected JSON: `{"ok":true}`.
3. Check `https://cv-n-backend.vercel.app/api/config` — expected store configuration JSON.
4. Check `https://cv-n-backend.vercel.app/p/<an-existing-product-slug>` — should return HTML containing product-specific title, description, Open Graph and JSON-LD metadata.
5. Deploy the frontend project with Root Directory set to `frontend`.
6. Check `https://cvgadgets.vercel.app/api/config` and `/api/categories` — both should return JSON, not the frontend 404 page.
7. Check `/shop`, `/cart`, `/login`, `/account`, `/category/<slug>`, `/p/<slug>`.
8. Sign in with a customer account. Successful sign-in should navigate to `/account` even if cart or wishlist sync has a temporary error. Staff should navigate to `/admin`.
9. In Vercel Cron Jobs, confirm `/api/cron/expire-orders` is scheduled. Vercel sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured. Check the function logs for successful runs.
10. Confirm Cloudinary uploads return `https://res.cloudinary.com/...` URLs.

## Important security note

The original uploaded archive included a `.env` file. This fixed archive intentionally excludes `.env`, `.git`, and `node_modules`. If any credentials in that `.env` were ever committed or shared, rotate them before production deployment. Never upload `.env` to GitHub or Vercel as a file; enter each variable in Vercel Project Settings.
