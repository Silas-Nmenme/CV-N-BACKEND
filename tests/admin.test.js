import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import sharp from "sharp";
import { bootstrap, client, startGatewayStub } from "./helpers.js";

let ctx, gw, admin, shop;
const item = async (sku, quantity = 1) => {
  const p = await ctx.models.Product.findOne({ "variants.sku": sku });
  return { productId: String(p._id), sku, quantity };
};
const orderBody = (items, extra = {}) => ({
  items,
  customer: { fullName: "Tunde Bello", email: "tunde@example.com", phone: "08051234567" },
  shipping: { state: "Lagos", city: "Lekki", address: "3 Admiralty Way", method: "standard" },
  paymentMethod: "bank_transfer",
  ...extra,
});

before(async () => {
  gw = await startGatewayStub();
  ctx = await bootstrap({ dbName: "cvg_test_admin", gateway: gw });
  admin = client(ctx.base);
  shop = client(ctx.base);
  const r = await admin.post("/api/auth/login", { email: "owner@test.ng", password: "Owner12345" });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.isStaff, true);
});
after(async () => ctx.close());

test("configured storefront gets credentialed CORS and preflight access", async () => {
  const shopPage = await fetch(`${ctx.base}/shop`);
  assert.equal(shopPage.status, 200);
  assert.match(await shopPage.text(), /CV GADGETS/);

  const { createApp } = await import("../server/app.js");
  const apiOnlyServer = http.createServer(createApp({ serveFrontend: false }));
  await new Promise((resolve) => apiOnlyServer.listen(0, "127.0.0.1", resolve));
  const apiOnlyUrl = `http://127.0.0.1:${apiOnlyServer.address().port}`;
  try {
    const root = await fetch(apiOnlyUrl);
    assert.equal(root.status, 200);
    assert.deepEqual(await root.json(), { ok: true, service: "CV GADGETS API" });
  } finally {
    await new Promise((resolve) => apiOnlyServer.close(resolve));
  }

  const health = await fetch(`${ctx.base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const origin = "https://store.example.test";
  const response = await fetch(`${ctx.base}/api/config`, { headers: { Origin: origin } });
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");

  const deployedStore = await fetch(`${ctx.base}/api/config`, {
    headers: { Origin: "https://cvgadgets.vercel.app" },
  });
  assert.equal(deployedStore.headers.get("access-control-allow-origin"), "https://cvgadgets.vercel.app");

  const preflight = await fetch(`${ctx.base}/api/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods").includes("POST"), true);

  const denied = await fetch(`${ctx.base}/api/auth/login`, {
    method: "OPTIONS",
    headers: { Origin: "https://untrusted.example.test", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(denied.status, 403);
});

async function settings() {
  return (await admin.get("/api/admin/settings")).data;
}

test("settings: bank transfer needs details, WhatsApp is normalised, secrets are never exposed", async () => {
  const s = await settings();
  assert.equal(s.credentials.paystack, true);
  assert.ok(s.webhookUrls.paystack.endsWith("/api/webhooks/paystack"));
  assert.equal(JSON.stringify(s).includes("sk_test_secret"), false, "secret keys never leave the server");
  const base = JSON.parse(JSON.stringify(s.settings));
  delete base._id; delete base.__v; delete base.key; delete base.createdAt; delete base.updatedAt;
  base.payments.bankTransfer = true;
  let r = await admin.put("/api/admin/settings", base);
  assert.equal(r.status, 400, "no bank details yet");
  base.payments.bankName = "Test Bank";
  base.payments.accountName = "CV GADGETS LTD";
  base.payments.accountNumber = "0123456789";
  base.store.whatsapp = "0803 123 4567";
  base.store.email = "shop@cvgadgets.test";
  r = await admin.put("/api/admin/settings", base);
  assert.equal(r.status, 200);
  const cfg = await shop.get("/api/config");
  assert.equal(cfg.data.store.whatsapp, "2348031234567");
  assert.ok(cfg.data.payments.methods.includes("bank_transfer"));
  assert.equal(cfg.data.payments.bank.accountNumber, "0123456789");
});

test("bank transfer: customer reports payment, admin must confirm the exact amount", async () => {
  const it = await item("IP13-128-MD-U", 1);
  const placed = await shop.post("/api/orders", orderBody([it]));
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  assert.equal(placed.data.bank.accountNumber, "0123456789");
  const { reference, total } = placed.data.order;
  const token = placed.data.accessToken;

  // Admin cannot ship an unpaid order
  let r = await admin.patch(`/api/admin/orders/${reference}/status`, { status: "dispatched", courier: "GIG" });
  assert.equal(r.status, 409);

  const notice = await shop.post(`/api/orders/${reference}/transfer-notice`, { t: token, senderName: "Tunde Bello" });
  assert.equal(notice.status, 200);
  assert.equal(notice.data.order.payment.status, "awaiting_confirmation");

  r = await admin.post(`/api/admin/orders/${reference}/confirm-payment`, { amountReceived: total - 1000 });
  assert.equal(r.status, 400, "underpayment refused");
  r = await admin.post(`/api/admin/orders/${reference}/confirm-payment`, { amountReceived: total });
  assert.equal(r.status, 200);
  assert.equal(r.data.order.payment.status, "paid");
  assert.equal(r.data.order.status, "confirmed");
  assert.equal((await admin.post(`/api/admin/orders/${reference}/confirm-payment`, { amountReceived: total })).status, 409, "cannot confirm twice");

  // Full lifecycle
  r = await admin.patch(`/api/admin/orders/${reference}/status`, { status: "dispatched" });
  assert.equal(r.status, 400, "courier is required to dispatch");
  r = await admin.patch(`/api/admin/orders/${reference}/status`, { status: "dispatched", courier: "GIG Logistics", trackingNumber: "GIG123" });
  assert.equal(r.status, 200);
  assert.equal(r.data.order.dispatch.trackingNumber, "GIG123");
  assert.equal((await admin.patch(`/api/admin/orders/${reference}/status`, { status: "confirmed" })).status, 409, "no going backwards");
  r = await admin.patch(`/api/admin/orders/${reference}/status`, { status: "delivered" });
  assert.equal(r.data.order.status, "delivered");
  const detail = await admin.get(`/api/admin/orders/${reference}`);
  assert.ok(detail.data.order.statusHistory.length >= 4);
  const mails = ctx.mailer.mailLog.filter((m) => /Tunde|tunde/.test(m.to) && m.subject.includes(reference));
  assert.ok(mails.length >= 3, "customer received emails along the way");
});

test("online payments cannot be confirmed by hand (only re-verified with the gateway)", async () => {
  const it = await item("IP13-128-MD-U", 1);
  const placed = await shop.post("/api/orders", orderBody([it], { paymentMethod: "paystack" }));
  const r = await admin.post(`/api/admin/orders/${placed.data.order.reference}/confirm-payment`, { amountReceived: placed.data.order.total });
  assert.equal(r.status, 409);
  const init = await shop.post("/api/payments/initialize", { orderReference: placed.data.order.reference, accessToken: placed.data.accessToken, provider: "paystack" });
  gw.state.paystack.get(init.data.reference).status = "success";
  const v = await admin.post(`/api/admin/orders/${placed.data.order.reference}/verify-payment`);
  assert.equal(v.data.status, "success");
});

test("cancelling a paid order restores stock and flags the refund", async () => {
  const sku = "IP13-128-MD-U";
  const before = (await ctx.models.Product.findOne({ "variants.sku": sku })).variants.find((v) => v.sku === sku).stock;
  const it = await item(sku, 2);
  const placed = await shop.post("/api/orders", orderBody([it]));
  const { reference, total } = placed.data.order;
  await admin.post(`/api/admin/orders/${reference}/confirm-payment`, { amountReceived: total });
  const r = await admin.patch(`/api/admin/orders/${reference}/status`, { status: "cancelled", note: "Customer changed mind", refund: true });
  assert.equal(r.status, 200);
  const o = await ctx.models.Order.findOne({ reference });
  assert.equal(o.status, "cancelled");
  assert.equal(o.payment.status, "refunded");
  assert.equal((await ctx.models.Product.findOne({ "variants.sku": sku })).variants.find((v) => v.sku === sku).stock, before);
});

/* ------------------------------ products ------------------------------ */
const productBody = (over = {}) => ({
  name: "Samsung Galaxy S25",
  brand: null, category: null, series: "Galaxy S", model: "S25",
  description: "Test phone", highlights: ["Fast"], specs: { chipset: "Snapdragon", display: "6.2-inch" },
  warranty: "12 months", network: "5G", tags: ["samsung"],
  images: [],
  variants: [{ sku: "s25-128-bk", attrs: { storage: "128GB", ram: "8GB", colour: "Black", condition: "Brand New" }, price: 1100000, comparePrice: 1200000, stock: 5, active: true }],
  featured: true, bestseller: false, newArrival: true, onOffer: false, active: true,
  ...over,
});

test("admin can create, edit, filter and delete products (new models need no code changes)", async () => {
  const brands = (await admin.get("/api/admin/brands")).data.items;
  const cats = (await admin.get("/api/admin/categories")).data.items;
  const samsung = brands.find((b) => b.slug === "samsung")._id;
  const phones = cats.find((c) => c.slug === "phones")._id;
  const body = productBody({ brand: samsung, category: phones });

  assert.equal((await admin.post("/api/admin/products", { ...body, name: "" })).status, 400);
  let r = await admin.post("/api/admin/products", { ...body, variants: [{ ...body.variants[0], comparePrice: 900000 }] });
  assert.equal(r.status, 400, "compare price must exceed selling price");
  assert.match(r.data.message, /higher than the selling price/);
  r = await admin.post("/api/admin/products", { ...body, variants: [body.variants[0], { ...body.variants[0] }] });
  assert.equal(r.status, 400, "duplicate SKUs in one product");
  r = await admin.post("/api/admin/products", { ...body, variants: [{ ...body.variants[0], price: -5 }] });
  assert.equal(r.status, 400);

  r = await admin.post("/api/admin/products", body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.item._id;
  assert.equal(r.data.item.slug, "samsung-galaxy-s25-s25".replace("-s25-s25", "-s25"));
  assert.equal(r.data.item.variants[0].sku, "S25-128-BK");
  assert.equal(r.data.item.minPrice, 1100000);
  assert.equal(r.data.item.maxDiscountPct, 8);
  assert.equal(r.data.item.brandName, "Samsung");

  // visible in the public catalogue and detail page with only phone specs
  let pub = await shop.get("/api/products?q=s25");
  assert.equal(pub.data.total, 1);
  pub = await shop.get(`/api/products/${r.data.item.slug}`);
  assert.deepEqual(pub.data.product.specGroups.map((g) => g.group).sort(), ["Connectivity", "Display", "Performance", "Warranty"]);
  assert.ok(!JSON.stringify(pub.data.product.specGroups).includes("Processor"), "phones never show laptop fields");

  // same SKU in another product is rejected by the database
  const dupe = await admin.post("/api/admin/products", { ...body, name: "Another phone", variants: [{ ...body.variants[0], sku: "S25-128-BK" }] });
  assert.equal(dupe.status, 409);

  // edit: add a variant and change price
  const edit = await admin.put(`/api/admin/products/${id}`, { ...body, variants: [...body.variants, { sku: "S25-256-BK", attrs: { storage: "256GB", colour: "Black", condition: "Brand New" }, price: 1250000, stock: 0, active: true }] });
  assert.equal(edit.status, 200);
  assert.equal(edit.data.item.maxPrice, 1250000);
  assert.equal(edit.data.item.totalStock, 5);

  // inline stock + toggles
  assert.equal((await admin.patch(`/api/admin/products/${id}/stock`, { sku: "S25-256-BK", stock: 4 })).data.item.totalStock, 9);
  assert.equal((await admin.patch(`/api/admin/products/${id}/quick`, { active: false })).data.item.active, false);
  assert.equal((await shop.get(`/api/products/${r.data.item.slug}`)).status, 404, "inactive products vanish from the shop");
  await admin.patch(`/api/admin/products/${id}/quick`, { active: true });

  const lowList = await admin.get("/api/admin/products?stock=low");
  assert.ok(lowList.data.items.every((p) => p.variants.some((v) => v.stock > 0 && v.stock <= p.lowStockThreshold)));
  assert.equal((await admin.get("/api/admin/products?stock=out")).data.items.every((p) => p.totalStock === 0), true);

  assert.equal((await admin.del(`/api/admin/products/${id}`)).status, 200);
  assert.equal((await admin.get(`/api/admin/products/${id}`)).status, 404);
});

test("image uploads are re-encoded to WebP and non-images are refused", async () => {
  const png = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#2145f5" } }).png().toBuffer();
  const fd = new FormData();
  fd.append("images", new Blob([png], { type: "image/png" }), "phone.png");
  let r = await admin.post("/api/admin/products/upload?folder=products", null, { raw: fd });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const img = r.data.images[0];
  assert.match(img.url, /^\/uploads\/products\/[a-f0-9]+\.webp$/);
  const file = await shop.get(img.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/webp");
  const meta = await sharp(Buffer.from(await (await fetch(ctx.base + img.url)).arrayBuffer())).metadata();
  assert.equal(meta.width, 1400, "large images are resized");

  const fake = new FormData();
  fake.append("images", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "x.png");
  r = await admin.post("/api/admin/products/upload", null, { raw: fake });
  assert.equal(r.status, 400, "content that is not an image is rejected even with an image MIME type");
  const svg = new FormData();
  svg.append("images", new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], { type: "image/svg+xml" }), "x.svg");
  assert.equal((await admin.post("/api/admin/products/upload", null, { raw: svg })).status, 400, "SVG uploads are not allowed");
  assert.equal((await shop.post("/api/admin/products/upload", null, { raw: fake })).status, 401);
});

/* ------------------------------ catalogue structure ------------------------------ */
test("categories carry editable spec templates; new categories and brands work end to end", async () => {
  let r = await admin.post("/api/admin/categories", { name: "Smartwatches", description: "Watches", specFields: [{ key: "caseSize", label: "Case size", unit: "mm", filterable: true }], variantAttrs: [{ key: "colour", label: "Colour", swatch: true }] });
  assert.equal(r.status, 201);
  assert.equal(r.data.item.slug, "smartwatches");
  const catId = r.data.item._id;
  assert.equal((await admin.post("/api/admin/categories", { name: "Bad", specFields: [{ key: "Bad Key", label: "x" }] })).status, 400);
  r = await admin.post("/api/admin/brands", { name: "Anker" });
  assert.equal(r.status, 201);
  const brandId = r.data.item._id;
  r = await admin.post("/api/admin/products", productBody({ name: "Anker Watch", brand: brandId, category: catId, specs: { caseSize: "44" }, variants: [{ sku: "ANK-W1", attrs: { colour: "Black" }, price: 50000, stock: 3, active: true }] }));
  assert.equal(r.status, 201);
  const pub = await shop.get(`/api/products/${r.data.item.slug}`);
  assert.deepEqual(pub.data.product.specGroups[0].items[0], { label: "Case size", value: "44 mm" });
  const facets = await shop.get("/api/products/facets?category=smartwatches");
  assert.equal(facets.data.specs[0].key, "caseSize");
  assert.equal((await admin.del(`/api/admin/categories/${catId}`)).status, 409, "cannot delete a category that has products");
  const cats = (await admin.get("/api/admin/categories")).data.items;
  const phones = cats.find((c) => c.slug === "phones")._id;
  const cyc = await admin.put(`/api/admin/categories/${phones}`, { name: "Phones", parent: phones });
  assert.equal(cyc.status, 400);
});

/* ------------------------------ coupons ------------------------------ */
test("coupons: validation, limits, minimum spend and category scoping", async () => {
  assert.equal((await admin.post("/api/admin/coupons", { code: "BAD", type: "percent", value: 150 })).status, 400);
  const cats = (await admin.get("/api/admin/categories")).data.items;
  const chargers = cats.find((c) => c.slug === "chargers-and-accessories")._id;
  let r = await admin.post("/api/admin/coupons", { code: "charge10", type: "percent", value: 10, categories: [chargers], minSubtotal: 10000, usageLimit: 1, perUserLimit: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.data.item.code, "CHARGE10");
  const phone = await item("IP13-128-MD-U", 1);
  const charger = await item("SAM-25W-BK", 1);
  let q = await shop.post("/api/cart/quote", { items: [phone], couponCode: "CHARGE10" });
  assert.match(q.data.couponError, /does not apply/);
  q = await shop.post("/api/cart/quote", { items: [phone, charger], couponCode: "CHARGE10" });
  assert.equal(q.data.discount, 1700, "10% of the charger only");
  const placed = await shop.post("/api/orders", orderBody([charger], { couponCode: "CHARGE10", paymentMethod: "paystack" }));
  assert.equal(placed.status, 201);
  assert.equal(placed.data.order.discount, 1700);
  q = await shop.post("/api/cart/quote", { items: [charger], couponCode: "CHARGE10" });
  assert.match(q.data.couponError, /usage limit/);
  assert.equal((await shop.post("/api/orders", orderBody([charger], { couponCode: "CHARGE10", paymentMethod: "paystack" }))).status, 400, "strict at checkout");
});

/* ------------------------------ staff & permissions ------------------------------ */
test("staff roles: support can handle orders but not products or settings; only admins manage staff", async () => {
  let r = await admin.post("/api/admin/customers/staff", { name: "Support Sam", email: "sam@test.ng", password: "Support123", role: "support" });
  assert.equal(r.status, 201);
  await admin.post("/api/admin/customers/staff", { name: "Manager Mo", email: "mo@test.ng", password: "Manager123", role: "manager" });
  const sup = client(ctx.base);
  const login = await sup.post("/api/auth/login", { email: "sam@test.ng", password: "Support123" });
  assert.equal(login.data.user.role, "support");
  assert.equal((await sup.get("/api/admin/orders")).status, 200);
  assert.equal((await sup.get("/api/admin/stats")).status, 200);
  assert.equal((await sup.get("/api/admin/products")).status, 403);
  assert.equal((await sup.get("/api/admin/settings")).status, 403);
  assert.equal((await sup.get("/api/admin/customers/staff/list")).status, 403);
  assert.equal((await sup.post("/api/admin/customers/staff", { name: "Evil", email: "e@test.ng", password: "Passw0rd99", role: "admin" })).status, 403);

  const mgr = client(ctx.base);
  await mgr.post("/api/auth/login", { email: "mo@test.ng", password: "Manager123" });
  assert.equal((await mgr.get("/api/admin/products")).status, 200);
  assert.equal((await mgr.get("/api/admin/customers/staff/list")).status, 403, "managers can't manage staff");

  // suspending a staff member signs them out immediately
  const staff = (await admin.get("/api/admin/customers/staff/list")).data.staff;
  const sam = staff.find((s) => s.email === "sam@test.ng");
  await admin.patch(`/api/admin/customers/staff/${sam.id}`, { status: "suspended" });
  assert.equal((await sup.get("/api/admin/orders")).status, 401);
  const me = staff.find((s) => s.email === "owner@test.ng");
  assert.equal((await admin.patch(`/api/admin/customers/staff/${me.id}`, { role: "customer" })).status, 400, "admins cannot demote themselves");
});

/* ------------------------------ customers, reports, content ------------------------------ */
test("dashboard stats, reports and CSV exports reflect real paid orders", async () => {
  const s = await admin.get("/api/admin/stats");
  assert.equal(s.status, 200);
  assert.ok(s.data.totals.revenue > 0, "paid orders count towards revenue");
  assert.ok(s.data.totals.products >= 40);
  assert.equal(s.data.series.length, 30);
  assert.ok(Array.isArray(s.data.lowStock) && Array.isArray(s.data.outOfStock));
  assert.ok(s.data.outOfStockCount >= 1);
  const rep = await admin.get("/api/admin/reports/sales");
  assert.ok(rep.data.totals.orders >= 1);
  const csv = await admin.get("/api/admin/reports/sales?format=csv");
  assert.match(csv.data, /^period,orders,units/);
  const oc = await admin.get("/api/admin/orders/export.csv");
  assert.match(oc.data, /Reference/);
  assert.equal((await admin.get("/api/admin/orders?status=delivered")).data.orders.every((o) => o.status === "delivered"), true);
});

test("customers can be searched, viewed and suspended (which ends their session)", async () => {
  const c = client(ctx.base);
  await c.post("/api/auth/register", { name: "Susp Ended", email: "susp@example.com", password: "Passw0rd99" });
  const list = await admin.get("/api/admin/customers?q=susp");
  assert.equal(list.data.customers.length, 1);
  const id = list.data.customers[0].id;
  assert.equal((await admin.get(`/api/admin/customers/${id}`)).status, 200);
  assert.equal((await admin.patch(`/api/admin/customers/${id}`, { status: "suspended" })).status, 200);
  assert.equal((await c.get("/api/auth/me")).status, 401);
  assert.equal((await c.post("/api/auth/login", { email: "susp@example.com", password: "Passw0rd99" })).status, 403);
});

test("content management: banners, testimonials, pages, enquiries, subscribers", async () => {
  let r = await admin.post("/api/admin/banners", { title: "Black Friday", subtitle: "Big savings", ctaLink: "javascript:alert(1)" });
  assert.equal(r.status, 400, "unsafe links refused");
  r = await admin.post("/api/admin/banners", { title: "Black Friday", subtitle: "Big savings", ctaLink: "/shop?onOffer=1", theme: "ink", sortOrder: -1 });
  assert.equal(r.status, 201);
  assert.equal((await shop.get("/api/content/home")).data.hero[0].title, "Black Friday");
  r = await admin.post("/api/admin/testimonials", { name: "Kemi", location: "Ibadan", text: "My MacBook arrived the next day and works perfectly.", rating: 5 });
  assert.equal(r.status, 201);
  assert.equal((await shop.get("/api/content/home")).data.testimonials.some((t) => t.name === "Kemi"), true);

  r = await admin.put("/api/admin/pages/about", { title: "About us", body: "# About\n\nWelcome to {{store}}." });
  assert.equal(r.status, 200);
  assert.match((await shop.get("/api/pages/about")).data.page.body, /Welcome to CV GADGETS/);

  assert.equal((await shop.post("/api/contact", { name: "Ife", email: "ife@example.com", message: "Do you restock the iPad Air?" })).status, 201);
  await shop.post("/api/newsletter/subscribe", { email: "sub@example.com" });
  const enq = (await admin.get("/api/admin/enquiries")).data.items;
  assert.ok(enq.length >= 1);
  assert.equal((await admin.patch(`/api/admin/enquiries/${enq[0]._id}`, { status: "resolved", adminNote: "Called back" })).data.item.status, "resolved");
  const subs = await admin.get("/api/admin/subscribers");
  assert.ok(subs.data.total >= 1);
  assert.match((await admin.get("/api/admin/subscribers/export.csv")).data, /^email,subscribed_at/);
});
