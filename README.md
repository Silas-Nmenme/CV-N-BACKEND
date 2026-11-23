# CV GADGETS

A complete e-commerce platform for a Nigerian electronics retailer: phones (iPhone, Samsung), laptops (HP, Dell, Lenovo, MacBook), tablets and iPads, kids' tablets, and chargers and accessories.

Customer storefront, admin dashboard, REST API and database in one Node.js app. Prices are in Nigerian Naira (₦). Payments through **Paystack**, **Flutterwave** and **bank transfer**.

## What you get

| Area | Highlights |
|---|---|
| Storefront | Home with rotating hero, category tiles and product rails; catalogue with dynamic filters (brand, price, storage, RAM, processor, condition, availability) and sorting; product pages with linked variant pickers; cart with coupons and delivery estimate; checkout; order tracking; printable receipts; wishlist; reviews; WhatsApp enquiry buttons |
| Accounts | Register, sign in/out, forgot and reset password, profile, saved addresses, order history, change password, guest checkout |
| Payments | Paystack and Flutterwave (initialise, redirect, **server-side verification**, signed webhooks), bank transfer with manual confirmation, full payment history, receipts |
| Admin (`/admin`) | Dashboard (revenue, orders, customers, low stock, charts), products with variants and images, categories with editable spec templates, brands, orders, customers, coupons, reviews, delivery zones and fees, homepage banners, testimonials, editable policy pages, enquiries, subscribers, sales reports (CSV), staff roles, store settings |
| Nigeria | ₦ pricing, 36 states + FCT, Nigerian phone validation (`0803…` / `+234803…`), delivery by zone, WhatsApp links, local payment gateways |
| Security | bcrypt password hashing, httpOnly session cookies, role-based permissions, rate limiting, strict CSP, CSRF origin check, NoSQL-injection guard, Zod validation on every input, uploaded images re-encoded, no card data ever touches the server |

### How phones never show laptop specs

Each **category carries its own template**: the specification fields (Processor, Display, Wattage…) and the variant options (Storage, RAM, Colour, Condition…). Products only show the fields of their category, and the catalogue filters are built from the products that exist. You can add new models, categories, brands, spec fields and options in the dashboard with no code changes.

## Requirements

- Node.js 20 or newer
- MongoDB 6+ (local, Docker, or a free MongoDB Atlas cluster)

## Quick start (local)

```bash
npm install
cp .env.example .env        # then edit .env (see below)
npm run seed                # creates categories, brands, delivery zones, policy pages, and your admin
npm run seed:demo           # OPTIONAL: adds ~40 sample products with SAMPLE prices so the store isn't empty
npm run dev                 # http://localhost:3000   (admin at /admin)
```

Minimum `.env` for local development:

```
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/cv_gadgets
JWT_SECRET=any-long-random-string-at-least-32-characters
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=ChooseAStrongOne1
```

Payments need Paystack and/or Flutterwave keys; until you add them, checkout shows only the methods that are configured (bank transfer works once you add bank details in Admin → Settings). In development, emails are printed to the console when SMTP is not configured.

## Database setup and "migrations"

MongoDB is schema-less, so there are no SQL migrations. Instead:

- Indexes (including unique constraints on emails, SKUs, order references, coupon codes) are created automatically every time the server starts (`server/scripts/indexes.js`).
- `npm run seed` is **idempotent**. It creates anything missing and never overwrites data you have edited (category templates, settings, pages, zones).
- `npm run create-admin -- you@example.com "Passw0rd123" "Your Name"` creates an administrator without seeding anything else.
- Back up with `mongodump` (see `docs/DEPLOYMENT.md`).

## Configuring payments

1. Put the keys in `.env` (never in the dashboard): `PAYSTACK_SECRET_KEY`, `FLW_SECRET_KEY`, `FLW_SECRET_HASH`.
2. Add the webhook URLs in each dashboard (they are also shown in Admin → Settings):
   - Paystack → Settings → API Keys & Webhooks → Webhook URL: `https://YOUR-DOMAIN/api/webhooks/paystack`
   - Flutterwave → Settings → Webhooks → URL: `https://YOUR-DOMAIN/api/webhooks/flutterwave`, and set the **Secret hash** to the same value as `FLW_SECRET_HASH`.
3. In Admin → Settings, switch each payment method on or off and add your bank details for transfers.
4. Test with the gateways' **test keys** first. Paystack and Flutterwave both provide test cards.

**How a payment is trusted:** an order is marked paid only after the server asks Paystack/Flutterwave directly about that exact reference and checks the status, currency and that the amount equals the order total to the kobo. The browser redirect and webhook bodies are never trusted on their own. Wrong amounts are held for review, never auto-confirmed.

**Stock:** stock is reserved atomically when an order is placed (two people cannot buy the last unit). Unpaid orders release their stock after `PENDING_ORDER_MINUTES` (bank transfers: `BANK_TRANSFER_HOLD_HOURS`). If a payment arrives after release, the order is reinstated if stock still exists, otherwise it is flagged "refund required".

## Before you go live (checklist)

1. **Delivery** → Admin → Delivery zones: the seed creates the zones **inactive with ₦0 fees** (a business decision only you can make). Set real fees and tick *Zone is active*. Customers cannot check out to a state without an active zone.
2. **Settings:** add your phone, WhatsApp, email, address, opening hours, social links, and bank details if you accept transfers.
3. **Products:** if you ran `seed:demo`, delete the sample products (their prices are placeholders), the sample coupon `WELCOME5`, the sample testimonials and the sample banners. Add real products with real photos.
4. **Pages:** read and adjust About, FAQ, Privacy, Terms, Shipping and Returns in Admin → Content pages. They are sensible starting points, not legal advice. Have them reviewed for your business.
5. **Security:** use a new strong `JWT_SECRET`, a strong admin password, HTTPS, and live (not test) payment keys.
6. **Email:** configure SMTP so customers receive receipts and password-reset links.
7. Place a real small test order end to end (card payment, and a bank-transfer order you confirm in the dashboard).

## Admin roles

| Role | Can do |
|---|---|
| `admin` | Everything, including staff accounts |
| `manager` | Products, categories, brands, orders, customers, coupons, reviews, content, delivery, reports |
| `support` | View and update orders, view customers, moderate reviews, answer enquiries |

## Project structure

```
server/
  index.js, app.js          startup, middleware, static pages, SEO tags for product pages
  config/                   env + database
  models/                   Mongoose schemas (User, Product, Category, Order, Payment, Coupon, ...)
  routes/                   public + customer API; routes/admin/* = dashboard API
  services/                 pricing/coupons, delivery, stock + order lifecycle, payment gateways, email, images
  middleware/               auth + permissions, validation, rate limits, CSRF/NoSQL guards, errors
  scripts/                  seed, create-admin, demo data
client/
  *.html                    page shells
  assets/css, assets/js     design system + modules (core/ = shared, pages/ = one file per page)
  admin/                    admin single-page app
tests/                      automated API tests (node:test) + gateway stub
docs/DEPLOYMENT.md          production deployment guide
```

## Testing

```bash
npm test      # 35 API tests against a throwaway database (needs a local MongoDB on 127.0.0.1:27017)
```

The tests run the real server against a stub Paystack/Flutterwave, covering registration and lockout, password reset, pricing and coupons, concurrent last-item purchases, payment verification (success, failure, wrong amount, replayed and forged webhooks), order expiry, bank transfers, admin permissions, product/category CRUD, image upload validation, reviews and reports.

## API overview

Public: `GET /api/config`, `/api/categories`, `/api/brands`, `/api/products` (+ `/facets`, `/suggest`, `/:slug`), `POST /api/cart/quote`, `POST /api/orders`, `POST /api/payments/initialize|verify`, `POST /api/webhooks/paystack|flutterwave`.
Customer: `/api/auth/*`, `/api/account/*` (profile, addresses, wishlist, cart, orders).
Admin: `/api/admin/*` (requires a staff session; each route checks the role's permissions).

## Notes

- Product photos: demo products use generated illustrations. Upload real photos in Admin → Products (JPG/PNG/WebP/AVIF; resized and converted to WebP automatically). Set `CLOUDINARY_*` to store images in Cloudinary instead of server disk.
- Newsletter: the store collects subscribers (Admin → Subscribers → Export CSV). Send campaigns from your email tool of choice.
- The storefront is a fast multi-page app with server-inserted SEO tags and structured data on product pages.
# CV-N-BACKEND
