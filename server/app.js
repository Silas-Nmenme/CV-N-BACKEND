import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { originCheck, noSqlGuard } from "./middleware/security.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { uploadRoot } from "./services/images.js";
import { Product } from "./models/Product.js";
import { getSettings } from "./models/Misc.js";
import { expireStaleOrders } from "./services/orders.js";

import authRoutes from "./routes/auth.js";
import accountRoutes from "./routes/account.js";
import catalogRoutes from "./routes/catalog.js";
import checkoutRoutes from "./routes/checkout.js";
import paymentRoutes, { webhooks } from "./routes/payments.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "../frontend");

export function createApp({ serveFrontend = true } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy === "0" ? false : Number.isNaN(Number(env.trustProxy)) ? env.trustProxy : Number(env.trustProxy));

  app.use((req, res, next) => {
    res.vary("Origin");
    const origin = req.get("Origin")?.replace(/\/+$/, "");
    if (origin && env.extraOrigins.includes(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Credentials", "true");
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.set("Access-Control-Allow-Headers", req.get("Access-Control-Request-Headers") || "Content-Type");
        return res.sendStatus(204);
      }
    } else if (req.method === "OPTIONS") {
      return res.sendStatus(403);
    }
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'self'"],
          "form-action": ["'self'"],
          "object-src": ["'none'"],
          "upgrade-insecure-requests": env.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
    })
  );
  app.use(compression());

  // Webhooks need the exact bytes the provider signed.
  app.use(
    express.json({
      limit: "200kb",
      verify(req, _res, buf) {
        if (req.originalUrl.startsWith("/api/webhooks/")) req.rawBody = Buffer.from(buf);
      },
    })
  );
  app.use(cookieParser());

  app.get(["/health", "/healthz"], (req, res) => res.json({ ok: true }));

  app.use("/api", apiLimiter, originCheck, noSqlGuard);
  app.use("/api/auth", authRoutes);
  app.use("/api/account", accountRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/webhooks", webhooks);
  app.use("/api/admin", adminRoutes);
  app.use("/api", publicRoutes);
  app.use("/api", catalogRoutes);
  app.use("/api", checkoutRoutes);
  // These routes are also needed by the separate Vercel API deployment.
  // Cloudinary is the persistent store for new uploads; this static route only
  // serves any bundled/legacy files that still exist in the deployment.
  app.use(
    "/uploads",
    express.static(uploadRoot, { maxAge: "30d", immutable: true, setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff") })
  );

  // Product pages: server inserts title/description/OG tags so links shared on WhatsApp and Google look right.
  let productTemplate;
  app.get("/p/:slug", async (req, res, next) => {
    try {
      productTemplate ||= await fs.readFile(path.join(clientDir, "product.html"), "utf8");
      if (req.query.preview) {
        // Staff preview of an unpublished product: serve the bare shell (no product data, never indexed or cached).
        // The page then asks /api/products/:slug?preview=1, which only returns the product to signed-in staff.
        res.set("Cache-Control", "private, no-store");
        return res.type("html").send(productTemplate.replace("<!--SEO-->", `<title>Product preview</title><meta name="robots" content="noindex, nofollow">`));
      }
      const [p, s] = await Promise.all([Product.findOne({ slug: String(req.params.slug).toLowerCase(), active: true }, "name brandName description images minPrice totalStock slug").lean(), getSettings()]);
      const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      let head = "";
      if (p) {
        const desc = esc((p.description || `${p.name} from ${s.store.name}`).slice(0, 155));
        const img = p.images?.[0]?.url ? (p.images[0].url.startsWith("http") ? p.images[0].url : env.appUrl + p.images[0].url) : "";
        const ld = {
          "@context": "https://schema.org", "@type": "Product", name: p.name, brand: { "@type": "Brand", name: p.brandName }, image: img || undefined, description: p.description?.slice(0, 300),
          offers: { "@type": "Offer", priceCurrency: "NGN", price: p.minPrice, availability: p.totalStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: `${env.storefrontUrl}/p/${p.slug}` },
        };
        head = `<title>${esc(p.name)} | ${esc(s.store.name)}</title><meta name="description" content="${desc}"><meta property="og:title" content="${esc(p.name)}"><meta property="og:description" content="${desc}">${img ? `<meta property="og:image" content="${esc(img)}">` : ""}<meta property="og:type" content="product"><link rel="canonical" href="${env.storefrontUrl}/p/${esc(p.slug)}"><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
      } else {
        res.status(404);
        head = `<title>Product not found | ${esc(s.store.name)}</title><meta name="robots" content="noindex">`;
      }
      res.type("html").send(productTemplate.replace("<!--SEO-->", head));
    } catch (e) {
      next(e);
    }
  });


  // Vercel Cron calls this endpoint with Authorization: Bearer <CRON_SECRET>.
  app.get("/api/cron/expire-orders", async (req, res, next) => {
    try {
      const secret = process.env.CRON_SECRET;
      const authorization = req.get("authorization") || "";
      if (!secret || authorization !== `Bearer ${secret}`) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }
      const released = await expireStaleOrders();
      return res.json({ success: true, released });
    } catch (error) {
      next(error);
    }
  });

  app.use(notFound);

  if (!serveFrontend) {
    app.get("/", (_req, res) => res.json({ ok: true, service: "CV GADGETS API" }));
    app.use((req, res) => res.status(404).json({ success: false, message: "That endpoint does not exist." }));
    app.use(errorHandler);
    return app;
  }

  /* ----------------------------- static files ----------------------------- */
  app.use("/assets", express.static(path.join(clientDir, "assets"), { maxAge: env.isProd ? "7d" : 0 }));
  app.use("/admin/assets", express.static(path.join(clientDir, "admin", "assets"), { maxAge: env.isProd ? "1d" : 0 }));
  for (const f of ["favicon.svg", "robots.txt"]) app.get(`/${f}`, (req, res) => res.sendFile(path.join(clientDir, f)));

  const page = (file) => (req, res) => res.sendFile(path.join(clientDir, file));
  const routes = {
    "/": "index.html", "/shop": "shop.html", "/cart": "cart.html", "/checkout": "checkout.html", "/order": "order.html",
    "/payment-result": "payment-result.html", "/receipt": "receipt.html", "/login": "login.html", "/register": "register.html",
    "/forgot-password": "forgot-password.html", "/reset-password": "reset-password.html", "/account": "account.html",
    "/wishlist": "wishlist.html", "/contact": "contact.html", "/track-order": "track-order.html",
    "/about": "content.html", "/faq": "content.html", "/privacy-policy": "content.html", "/terms": "content.html",
    "/shipping-policy": "content.html", "/returns-policy": "content.html", "/unsubscribe": "unsubscribe.html",
  };
  for (const [url, file] of Object.entries(routes)) app.get(url, page(file));
  app.get(["/category/:slug", "/brand/:slug"], page("shop.html"));
  app.get(["/admin", "/admin/"], (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    res.sendFile(path.join(clientDir, "admin", "index.html"));
  });

  app.use((req, res) => res.status(404).sendFile(path.join(clientDir, "404.html")));
  app.use(errorHandler);
  return app;
}
