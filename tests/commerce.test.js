import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootstrap, client, startGatewayStub, paystackSig } from "./helpers.js";

let ctx, gw, api;
const item = async (sku, quantity = 1) => {
  const p = await ctx.models.Product.findOne({ "variants.sku": sku });
  assert.ok(p, `demo product with sku ${sku} should exist`);
  return { productId: String(p._id), sku, quantity };
};
const orderBody = (items, extra = {}) => ({
  items,
  customer: { fullName: "Ada Obi", email: "ada@example.com", phone: "0803 123 4567" },
  shipping: { state: "Lagos", city: "Ikeja", address: "12 Allen Avenue", method: "standard" },
  paymentMethod: "paystack",
  ...extra,
});
const stockOf = async (sku) => (await ctx.models.Product.findOne({ "variants.sku": sku })).variants.find((v) => v.sku === sku).stock;
const totalStockOf = async (sku) => (await ctx.models.Product.findOne({ "variants.sku": sku })).totalStock;

before(async () => {
  gw = await startGatewayStub();
  ctx = await bootstrap({ dbName: "cvg_test_commerce", gateway: gw });
  api = client(ctx.base);
});
after(async () => ctx.close());

/* ------------------------------ auth ------------------------------ */
test("registration validates input and enforces unique emails", async () => {
  const c = client(ctx.base);
  let r = await c.post("/api/auth/register", { name: "Bola", email: "bola@example.com", password: "short" });
  assert.equal(r.status, 400);
  r = await c.post("/api/auth/register", { name: "Bola", email: "bola@example.com", password: "alllettersnodigits" });
  assert.equal(r.status, 400);
  r = await c.post("/api/auth/register", { name: "Bola Ade", email: "bola@example.com", phone: "123", password: "Passw0rd99" });
  assert.equal(r.status, 400, "bad Nigerian phone number rejected");
  r = await c.post("/api/auth/register", { name: "Bola Ade", email: "bola@example.com", phone: "08031234567", password: "Passw0rd99" });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.phone, "+2348031234567");
  assert.equal(r.data.user.passwordHash, undefined, "never leak the hash");
  r = await c.post("/api/auth/register", { name: "Bola Ade", email: "BOLA@example.com", password: "Passw0rd99" });
  assert.equal(r.status, 409);
});

test("login, session, logout, lockout and password reset", async () => {
  const c = client(ctx.base);
  await c.post("/api/auth/register", { name: "Chi Obi", email: "chi@example.com", password: "Passw0rd99" });
  c.clearCookies();
  assert.equal((await c.get("/api/auth/me")).status, 401);
  assert.equal((await c.post("/api/auth/login", { email: "chi@example.com", password: "wrongpass1" })).status, 401);
  assert.equal((await c.post("/api/auth/login", { email: "nobody@example.com", password: "wrongpass1" })).status, 401);
  let r = await c.post("/api/auth/login", { email: "chi@example.com", password: "Passw0rd99" });
  assert.equal(r.status, 200);
  assert.equal((await c.get("/api/auth/me")).data.user.email, "chi@example.com");
  assert.equal((await c.get("/api/auth/me")).data.user.isStaff, false);
  await c.post("/api/auth/logout");
  assert.equal((await c.get("/api/auth/me")).status, 401);

  // forgot + reset
  r = await c.post("/api/auth/forgot-password", { email: "chi@example.com" });
  assert.equal(r.status, 200);
  assert.equal((await c.post("/api/auth/forgot-password", { email: "ghost@example.com" })).data.message, r.data.message, "no account enumeration");
  const mail = ctx.mailer.mailLog.filter((m) => m.to === "chi@example.com" && /Reset/.test(m.subject)).at(-1);
  const token = /token=([a-f0-9]+)/.exec(mail.html)[1];
  assert.equal((await c.post("/api/auth/reset-password", { token: "a".repeat(64), password: "NewPass123" })).status, 400);
  assert.equal((await c.post("/api/auth/reset-password", { token, password: "NewPass123" })).status, 200);
  assert.equal((await c.post("/api/auth/reset-password", { token, password: "Another123" })).status, 400, "token is single-use");
  c.clearCookies();
  assert.equal((await c.post("/api/auth/login", { email: "chi@example.com", password: "Passw0rd99" })).status, 401);
  assert.equal((await c.post("/api/auth/login", { email: "chi@example.com", password: "NewPass123" })).status, 200);
});

test("account locks after repeated failures", async () => {
  const c = client(ctx.base);
  await c.post("/api/auth/register", { name: "Lock Me", email: "lock@example.com", password: "Passw0rd99" });
  c.clearCookies();
  for (let i = 0; i < 8; i++) await c.post("/api/auth/login", { email: "lock@example.com", password: "badpass123" });
  const r = await c.post("/api/auth/login", { email: "lock@example.com", password: "Passw0rd99" });
  assert.equal(r.status, 429);
});

/* ------------------------------ pricing ------------------------------ */
test("quote uses server prices, caps coupons and computes delivery by state", async () => {
  const it = await item("IP13-128-MD-U", 2);
  const r = await api.post("/api/cart/quote", { items: [{ ...it, price: 1 }], couponCode: "welcome5", state: "Lagos", shippingMethod: "standard" });
  assert.equal(r.status, 200);
  assert.equal(r.data.subtotal, 820000, "client-sent price is ignored");
  assert.equal(r.data.coupon.code, "WELCOME5");
  assert.equal(r.data.discount, 25000, "5% of 820000 = 41000 capped at 25000");
  assert.equal(r.data.shippingFee, 3500);
  assert.equal(r.data.total, 820000 - 25000 + 3500);

  const north = await api.post("/api/cart/quote", { items: [it], state: "Kano", shippingMethod: "standard" });
  assert.equal(north.data.shippingFee, 9000);
  const bad = await api.post("/api/cart/quote", { items: [it], couponCode: "NOPE" });
  assert.equal(bad.data.couponError, "That coupon code is not valid.");
});

test("quote flags out-of-stock and reduces over-requests", async () => {
  const oos = await item("ZF5-256-MT-U", 1);
  let r = await api.post("/api/cart/quote", { items: [oos] });
  assert.equal(r.data.lines.length, 0);
  assert.equal(r.data.issues[0].type, "out_of_stock");
  const low = await item("IP13-256-RD-U", 9);
  r = await api.post("/api/cart/quote", { items: [low] });
  assert.equal(r.data.lines[0].quantity, 2);
  assert.equal(r.data.issues[0].type, "reduced");
});

test("delivery options come from admin-managed zones, with free-over threshold", async () => {
  const admin = client(ctx.base);
  await admin.post("/api/auth/login", { email: "owner@test.ng", password: "Owner12345" });
  const zones = await admin.get("/api/admin/delivery-zones");
  const lagos = zones.data.items.find((z) => z.name === "Lagos");
  lagos.methods = [{ code: "standard", name: "Standard delivery", fee: 3500, freeOver: 1000000, etaMinDays: 1, etaMaxDays: 2 }, { code: "express", name: "Same-day", fee: 6000 }];
  const put = await admin.put(`/api/admin/delivery-zones/${lagos._id}`, { name: lagos.name, states: lagos.states, methods: lagos.methods, active: true, sortOrder: 0 });
  assert.equal(put.status, 200);
  let r = await api.get("/api/delivery/options?state=Lagos&subtotal=500000");
  assert.deepEqual(r.data.options.map((o) => [o.code, o.fee]), [["standard", 3500], ["express", 6000]]);
  r = await api.get("/api/delivery/options?state=Lagos&subtotal=1200000");
  assert.equal(r.data.options[0].fee, 0);
  assert.equal(r.data.options[0].free, true);
  // overlapping zones are refused
  const dupe = await admin.post("/api/admin/delivery-zones", { name: "Dup", states: ["Lagos"], methods: [{ code: "x", name: "X", fee: 1 }], active: true });
  assert.equal(dupe.status, 409);
});

/* ------------------------------ orders & stock ------------------------------ */
test("order creation validates input and reserves stock", async () => {
  const it = await item("IP12-64-BK-U", 2);
  let r = await api.post("/api/orders", orderBody([it], { customer: { fullName: "A", email: "bad", phone: "123" } }));
  assert.equal(r.status, 400);
  r = await api.post("/api/orders", orderBody([it], { paymentMethod: "bank_transfer" }));
  assert.equal(r.status, 400, "bank transfer is off until the admin enables it");
  r = await api.post("/api/orders", orderBody([it], { shipping: { state: "Lagos", city: "Ikeja", address: "12 Allen Avenue", method: "teleport" } }));
  assert.equal(r.status, 400);

  const before = await stockOf("IP12-64-BK-U");
  r = await api.post("/api/orders", orderBody([it]));
  assert.equal(r.status, 201);
  assert.match(r.data.order.reference, /^CVG-\d{6}-[A-F0-9]{6}$/);
  assert.equal(r.data.order.total, 290000 * 2 + 3500);
  assert.equal(r.data.order.status, "pending_payment");
  assert.equal(r.data.order.payment.status, "pending");
  assert.ok(r.data.accessToken);
  assert.equal(await stockOf("IP12-64-BK-U"), before - 2);
  assert.equal(await totalStockOf("IP12-64-BK-U") >= 0, true);
});

test("two simultaneous buyers cannot oversell the last units", async () => {
  const it = await item("IP13-256-RD-U", 2); // stock is 2
  const results = await Promise.all([api.post("/api/orders", orderBody([it])), api.post("/api/orders", orderBody([it])), api.post("/api/orders", orderBody([it]))]);
  const ok = results.filter((r) => r.status === 201).length;
  assert.equal(ok, 1, `exactly one order wins (got ${results.map((r) => r.status)})`);
  assert.equal(await stockOf("IP13-256-RD-U"), 0);
});

test("guests can only open their order with the access token", async () => {
  const it = await item("IP11-64-BK-U", 1);
  const { data } = await api.post("/api/orders", orderBody([it]));
  const ref = data.order.reference;
  assert.equal((await api.get(`/api/orders/${ref}`)).status, 404);
  assert.equal((await api.get(`/api/orders/${ref}?t=wrong`)).status, 404);
  assert.equal((await api.get(`/api/orders/${ref}?t=${data.accessToken}`)).status, 200);
  assert.equal((await api.post("/api/orders/track", { reference: ref, contact: "other@example.com" })).status, 404);
  assert.equal((await api.post("/api/orders/track", { reference: ref, contact: "ada@example.com" })).status, 200);
  assert.equal((await api.post("/api/orders/track", { reference: ref, contact: "08031234567" })).status, 200, "phone formats are normalised");
});

/* ------------------------------ Paystack ------------------------------ */
async function placeOrder(sku, qty = 1, extra = {}) {
  const it = await item(sku, qty);
  const r = await api.post("/api/orders", orderBody([it], extra));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

test("Paystack: only a gateway-verified success marks the order paid", async () => {
  const { order, accessToken } = await placeOrder("IP14-128-MD-U");
  const init = await api.post("/api/payments/initialize", { orderReference: order.reference, accessToken, provider: "paystack" });
  assert.equal(init.status, 200);
  assert.match(init.data.url, /\/pay\//);
  const ref = init.data.reference;
  assert.equal(gw.state.paystack.get(ref).amount, order.total * 100, "amount sent to Paystack is in kobo");

  // Browser comes back from the gateway but the payment is NOT successful yet.
  let v = await api.post("/api/payments/verify", { reference: ref });
  assert.equal(v.data.status, "pending");
  let o = await ctx.models.Order.findOne({ reference: order.reference });
  assert.equal(o.payment.status, "pending");
  assert.equal(o.status, "pending_payment");

  gw.state.paystack.get(ref).status = "success";
  v = await api.post("/api/payments/verify", { reference: ref });
  assert.equal(v.data.status, "success");
  o = await ctx.models.Order.findOne({ reference: order.reference });
  assert.equal(o.payment.status, "paid");
  assert.equal(o.status, "confirmed");
  assert.ok(o.receiptNumber);
  const sold = (await ctx.models.Product.findOne({ "variants.sku": "IP14-128-MD-U" })).soldCount;

  // idempotent: verifying again (or a webhook) must not double-count anything
  await api.post("/api/payments/verify", { reference: ref });
  const hook = JSON.stringify({ event: "charge.success", data: { reference: ref } });
  const bad = await api.rawPost("/api/webhooks/paystack", hook, { "Content-Type": "application/json", "x-paystack-signature": "deadbeef" });
  assert.equal(bad.status, 401, "unsigned webhooks are rejected");
  const good = await api.rawPost("/api/webhooks/paystack", hook, { "Content-Type": "application/json", "x-paystack-signature": paystackSig(hook) });
  assert.equal(good.status, 200);
  assert.equal((await ctx.models.Product.findOne({ "variants.sku": "IP14-128-MD-U" })).soldCount, sold);

  // receipt available after payment, with token
  const rc = await api.get(`/api/orders/${order.reference}/receipt?t=${accessToken}`);
  assert.equal(rc.status, 200);
  assert.equal(rc.data.order.payment.status, "paid");
});

test("Paystack: a signed webhook alone confirms the order (user closed the tab)", async () => {
  const { order, accessToken } = await placeOrder("IP15-128-BL-U");
  const init = await api.post("/api/payments/initialize", { orderReference: order.reference, accessToken, provider: "paystack" });
  gw.state.paystack.get(init.data.reference).status = "success";
  const hook = JSON.stringify({ event: "charge.success", data: { reference: init.data.reference } });
  const r = await api.rawPost("/api/webhooks/paystack", hook, { "Content-Type": "application/json", "x-paystack-signature": paystackSig(hook) });
  assert.equal(r.status, 200);
  assert.equal((await ctx.models.Order.findOne({ reference: order.reference })).payment.status, "paid");
});

test("Paystack: a webhook claiming success is ignored if Paystack says otherwise", async () => {
  const { order, accessToken } = await placeOrder("IP15-128-BL-U");
  const init = await api.post("/api/payments/initialize", { orderReference: order.reference, accessToken, provider: "paystack" });
  const hook = JSON.stringify({ event: "charge.success", data: { reference: init.data.reference } });
  await api.rawPost("/api/webhooks/paystack", hook, { "Content-Type": "application/json", "x-paystack-signature": paystackSig(hook) });
  assert.equal((await ctx.models.Order.findOne({ reference: order.reference })).payment.status, "pending");
});

test("Paystack: wrong amount is never treated as paid", async () => {
  const { order, accessToken } = await placeOrder("IP15-128-BL-U");
  const init = await api.post("/api/payments/initialize", { orderReference: order.reference, accessToken, provider: "paystack" });
  const t = gw.state.paystack.get(init.data.reference);
  t.status = "success";
  t.overrideAmount = 100; // customer paid ₦1
  const v = await api.post("/api/payments/verify", { reference: init.data.reference });
  assert.equal(v.status, 409);
  const o = await ctx.models.Order.findOne({ reference: order.reference });
  assert.notEqual(o.payment.status, "paid");
  assert.equal(o.payment.status, "awaiting_confirmation");
  assert.equal(o.status, "pending_payment");
});

test("failed payments can be retried with a fresh attempt", async () => {
  const { order, accessToken } = await placeOrder("IP15-128-BL-U");
  const a = await api.post("/api/payments/initialize", { orderReference: order.reference, accessToken, provider: "paystack" });
  gw.state.paystack.get(a.data.reference).status = "failed";
  const v = await api.post("/api/payments/verify", { reference: a.data.reference });
  assert.equal(v.data.status, "failed");
  const b = await api.post("/api/payments/initialize", { orderReference: order.reference, accessToken, provider: "paystack" });
  assert.notEqual(b.data.reference, a.data.reference);
  assert.match(b.data.reference, /-P2$/);
  const history = await ctx.models.Payment.find({ orderReference: order.reference });
  assert.equal(history.length, 2);
});

test("payments cannot be initialised for someone else's order without the token", async () => {
  const { order } = await placeOrder("IP15-128-BL-U");
  const r = await api.post("/api/payments/initialize", { orderReference: order.reference, provider: "paystack" });
  assert.equal(r.status, 404);
});

/* ------------------------------ Flutterwave ------------------------------ */
test("Flutterwave: initialise, verify and webhook (verif-hash) flow", async () => {
  const { order, accessToken } = await placeOrder("IP11-128-GR-U", 1);
  const init = await api.post("/api/payments/initialize", { orderReference: order.reference, accessToken, provider: "flutterwave" });
  assert.equal(init.status, 200);
  assert.match(init.data.url, /\/pay\//);
  assert.equal(gw.state.flw.get(init.data.reference).amount, order.total, "Flutterwave takes naira, not kobo");

  const noHash = await api.post("/api/webhooks/flutterwave", { event: "charge.completed", data: { tx_ref: init.data.reference } });
  assert.equal(noHash.status, 401);

  gw.state.flw.get(init.data.reference).status = "successful";
  const ok = await api.post("/api/webhooks/flutterwave", { event: "charge.completed", data: { tx_ref: init.data.reference } }, { headers: { "verif-hash": "flw-hash-123" } });
  assert.equal(ok.status, 200);
  const o = await ctx.models.Order.findOne({ reference: order.reference });
  assert.equal(o.payment.status, "paid");
  assert.equal(o.payment.method, "flutterwave");
});

/* ------------------------------ expiry ------------------------------ */
test("unpaid orders expire and give stock and coupon use back", async () => {
  const it = await item("IP11-64-BK-U", 3);
  const stockBefore = await stockOf("IP11-64-BK-U");
  const used = (await ctx.models.Coupon.findOne({ code: "WELCOME5" })).usedCount;
  const r = await api.post("/api/orders", orderBody([it], { couponCode: "WELCOME5" }));
  assert.equal(r.status, 201);
  assert.equal(await stockOf("IP11-64-BK-U"), stockBefore - 3);
  assert.equal((await ctx.models.Coupon.findOne({ code: "WELCOME5" })).usedCount, used + 1);

  await ctx.models.Order.updateOne({ reference: r.data.order.reference }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const n = await ctx.orders.expireStaleOrders();
  assert.ok(n >= 1);
  const o = await ctx.models.Order.findOne({ reference: r.data.order.reference });
  assert.equal(o.status, "cancelled");
  assert.equal(await stockOf("IP11-64-BK-U"), stockBefore);
  assert.equal((await ctx.models.Coupon.findOne({ code: "WELCOME5" })).usedCount, used);
  await ctx.orders.expireStaleOrders(); // second sweep must not double-restore
  assert.equal(await stockOf("IP11-64-BK-U"), stockBefore);
});

test("payment arriving after expiry reinstates the order when stock allows", async () => {
  const { order, accessToken } = await placeOrder("IP12-128-WH-U", 1);
  const init = await api.post("/api/payments/initialize", { orderReference: order.reference, accessToken, provider: "paystack" });
  await ctx.models.Order.updateOne({ reference: order.reference }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await ctx.orders.expireStaleOrders();
  assert.equal((await ctx.models.Order.findOne({ reference: order.reference })).status, "cancelled");
  gw.state.paystack.get(init.data.reference).status = "success";
  const v = await api.post("/api/payments/verify", { reference: init.data.reference });
  assert.equal(v.data.status, "success");
  const o = await ctx.models.Order.findOne({ reference: order.reference });
  assert.equal(o.status, "confirmed");
  assert.equal(o.stockReserved, true);
});

/* ------------------------------ security ------------------------------ */
test("security: operator injection and cross-site writes are blocked", async () => {
  let r = await api.post("/api/auth/login", { email: { $gt: "" }, password: "x" });
  assert.equal(r.status, 400);
  r = await api.get("/api/products?category[$ne]=x");
  assert.equal(r.status, 400);
  r = await api.post("/api/contact", { name: "Eve", email: "eve@example.com", message: "Hello there friend" }, { headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  r = await api.post("/api/contact", { name: "Eve", email: "eve@example.com", message: "Hello there friend" });
  assert.equal(r.status, 201);
  const h = (await api.get("/healthz")).headers;
  assert.ok(h.get("content-security-policy"));
  assert.equal(h.get("x-powered-by"), null);
});

test("security: admin APIs reject anonymous users and customers", async () => {
  const anon = client(ctx.base);
  assert.equal((await anon.get("/api/admin/stats")).status, 401);
  const cust = client(ctx.base);
  await cust.post("/api/auth/register", { name: "Plain User", email: "plain@example.com", password: "Passw0rd99" });
  for (const p of ["/api/admin/stats", "/api/admin/orders", "/api/admin/products", "/api/admin/customers", "/api/admin/settings"]) {
    assert.equal((await cust.get(p)).status, 403, p);
  }
});

/* ------------------------------ wishlist, cart, reviews, content ------------------------------ */
test("wishlist and saved cart persist for signed-in customers", async () => {
  const c = client(ctx.base);
  await c.post("/api/auth/register", { name: "Wish Lister", email: "wish@example.com", password: "Passw0rd99" });
  const p = await ctx.models.Product.findOne({ slug: "iphone-15" });
  assert.equal((await c.post(`/api/account/wishlist/${p._id}`)).data.ids.length, 1);
  await c.post(`/api/account/wishlist/${p._id}`);
  assert.equal((await c.get("/api/account/wishlist")).data.products.length, 1, "no duplicates");
  assert.equal((await c.del(`/api/account/wishlist/${p._id}`)).data.ids.length, 0);

  const it = await item("IP13-128-MD-U", 2);
  const put = await c.put("/api/account/cart", { items: [it, { productId: String(p._id), sku: "NOT-A-SKU", quantity: 1 }] });
  assert.equal(put.data.items.length, 1, "invalid lines are dropped");
  assert.equal((await c.get("/api/account/cart")).data.items[0].quantity, 2);

  const addr = await c.post("/api/account/addresses", { fullName: "Wish Lister", phone: "08031234567", state: "Lagos", city: "Yaba", address: "5 Herbert Macaulay Way" });
  assert.equal(addr.status, 201);
  assert.equal(addr.data.addresses[0].isDefault, true);
  assert.equal((await c.post("/api/account/addresses", { fullName: "X Y", phone: "1", state: "Mars", city: "Yaba", address: "5 Herbert Way" })).status, 400);
});

test("reviews: unverified go to moderation, verified purchases publish and update the rating", async () => {
  const buyer = client(ctx.base);
  await buyer.post("/api/auth/register", { name: "Real Buyer", email: "buyer@example.com", password: "Passw0rd99" });
  const p = await ctx.models.Product.findOne({ slug: "iphone-14" });
  let r = await buyer.post(`/api/products/${p._id}/reviews`, { rating: 4, body: "Good phone but not bought here." });
  assert.equal(r.data.status, "pending");
  assert.equal((await api.get(`/api/products/${p._id}/reviews`)).data.total, 0);
  assert.equal((await buyer.post(`/api/products/${p._id}/reviews`, { rating: 5, body: "Second attempt" })).status, 409);

  const admin = client(ctx.base);
  await admin.post("/api/auth/login", { email: "owner@test.ng", password: "Owner12345" });
  const list = await admin.get("/api/admin/reviews?status=pending");
  const rev = list.data.items.find((x) => String(x.product._id) === String(p._id));
  await admin.patch(`/api/admin/reviews/${rev._id}`, { status: "approved" });
  const detail = await api.get("/api/products/iphone-14");
  assert.equal(detail.data.product.ratingCount, 1);
  assert.equal(detail.data.product.ratingAvg, 4);

  const buyer2 = client(ctx.base);
  await buyer2.post("/api/auth/register", { name: "Paid Buyer", email: "paid@example.com", password: "Passw0rd99" });
  const it = await item("IP14-256-PU-U", 1);
  const o = await buyer2.post("/api/orders", orderBody([it], { customer: { fullName: "Paid Buyer", email: "paid@example.com", phone: "08031234567" } }));
  const init = await buyer2.post("/api/payments/initialize", { orderReference: o.data.order.reference, provider: "paystack" });
  gw.state.paystack.get(init.data.reference).status = "success";
  await buyer2.post("/api/payments/verify", { reference: init.data.reference });
  r = await buyer2.post(`/api/products/${p._id}/reviews`, { rating: 5, title: "Great", body: "Arrived well packed and works perfectly." });
  assert.equal(r.data.status, "approved");
  assert.equal((await api.get("/api/products/iphone-14")).data.product.ratingCount, 2);
});

test("public content: config, home content, policy pages with tokens, newsletter, contact", async () => {
  const cfg = await api.get("/api/config");
  assert.equal(cfg.data.currency.symbol, "₦");
  assert.equal(cfg.data.states.length, 37);
  assert.deepEqual(cfg.data.payments.methods.sort(), ["flutterwave", "paystack"]);
  assert.equal(cfg.data.store.paystackSecret, undefined);
  const home = await api.get("/api/content/home");
  assert.ok(home.data.hero.length >= 1);
  const ret = await api.get("/api/pages/returns-policy");
  assert.match(ret.data.page.body, /within 7 days/);
  assert.equal((await api.get("/api/pages/nope")).status, 404);
  assert.equal((await api.post("/api/newsletter/subscribe", { email: "news@example.com" })).status, 200);
  assert.equal((await api.post("/api/newsletter/subscribe", { email: "news@example.com" })).status, 200, "idempotent");
  assert.equal((await api.post("/api/newsletter/subscribe", { email: "nope" })).status, 400);
  assert.equal((await api.post("/api/contact", { name: "A", email: "a@b.co", message: "short" })).status, 400);
});
