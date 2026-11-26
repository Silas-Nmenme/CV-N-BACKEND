import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { bootstrap, client, startGatewayStub } from "./helpers.js";

/**
 * Policy: nobody can place an order without signing in.
 * Browsing, the cart and cart quotes stay open to guests, and existing orders can still be opened with their token.
 */

let ctx, gw, guest, member, item;
const orderBody = (over = {}) => ({
  items: [item],
  customer: { fullName: "Ada Obi", email: "ada@example.com", phone: "0803 123 4567" },
  shipping: { state: "Lagos", city: "Ikeja", address: "12 Allen Avenue", method: "standard" },
  paymentMethod: "paystack",
  ...over,
});
const stockLeft = async () => (await ctx.models.Product.findOne({ "variants.sku": item.sku })).variants.find((v) => v.sku === item.sku).stock;

before(async () => {
  gw = await startGatewayStub();
  ctx = await bootstrap({ dbName: "cvg_test_checkout_login", gateway: gw });
  guest = client(ctx.base);
  member = client(ctx.base);
  const r = await member.post("/api/auth/register", { name: "Ada Obi", email: "ada@example.com", password: "Passw0rd99" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = await ctx.models.Product.findOne({ "variants.sku": "IP12-64-BK-U" });
  item = { productId: String(p._id), sku: "IP12-64-BK-U", quantity: 1 };
});
after(async () => ctx.close());

test("a guest cannot place an order: 401, nothing is created, no stock is reserved", async () => {
  const stock = await stockLeft();
  const orders = await ctx.models.Order.countDocuments();
  const r = await guest.post("/api/orders", orderBody());
  assert.equal(r.status, 401);
  assert.equal(r.data.success, false);
  assert.match(r.data.message, /sign in|log in|logged in/i);
  assert.equal(await ctx.models.Order.countDocuments(), orders, "no order was created");
  assert.equal(await stockLeft(), stock, "no stock was reserved");
});

test("guests are refused for every payment method, with or without a coupon, and a bad body still gets 401", async () => {
  for (const body of [orderBody({ paymentMethod: "bank_transfer" }), orderBody({ paymentMethod: "flutterwave" }), orderBody({ couponCode: "WELCOME5" }), { items: [], customer: {} }]) {
    assert.equal((await guest.post("/api/orders", body)).status, 401);
  }
});

test("a forged or garbage session cookie does not count as signed in", async () => {
  const userId = String((await ctx.models.User.findOne({ email: "ada@example.com" }))._id);
  // a well-formed JWT for a real user id, but signed with the wrong secret
  const forged = jwt.sign({ sub: userId, id: userId, uid: userId }, "not-the-server-secret");
  for (const cookie of ["not-a-real-token", forged]) {
    const r = await fetch(`${ctx.base}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `cvg_session=${cookie}` }, body: JSON.stringify(orderBody()) });
    assert.equal(r.status, 401);
  }
  // sanity: the same request with the real session cookie from a login is accepted
  const ok = await member.post("/api/orders", orderBody());
  assert.equal(ok.status, 201, "control: a genuine session works");
});

test("a signed-in customer can place an order, and it belongs to them", async () => {
  const stock = await stockLeft();
  const r = await member.post("/api/orders", orderBody());
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await stockLeft(), stock - 1);
  const order = await ctx.models.Order.findOne({ reference: r.data.order.reference });
  const user = await ctx.models.User.findOne({ email: "ada@example.com" });
  assert.equal(String(order.user), String(user._id), "the order is attached to the account");
  assert.equal((await member.get(`/api/orders/${r.data.order.reference}`)).status, 200, "the owner can open it without a token");
});

test("signing out (or a suspended account) means orders are refused again", async () => {
  const out = client(ctx.base);
  assert.equal((await out.post("/api/auth/login", { email: "ada@example.com", password: "Passw0rd99" })).status, 200);
  assert.equal((await out.post("/api/orders", orderBody())).status, 201, "signed in: allowed");
  await out.post("/api/auth/logout");
  assert.equal((await out.post("/api/orders", orderBody())).status, 401, "signed out: refused");

  const sus = client(ctx.base);
  await sus.post("/api/auth/login", { email: "ada@example.com", password: "Passw0rd99" });
  await ctx.models.User.updateOne({ email: "ada@example.com" }, { status: "suspended" });
  assert.equal((await sus.post("/api/orders", orderBody())).status, 401, "suspended account: refused");
  await ctx.models.User.updateOne({ email: "ada@example.com" }, { status: "active" });
});

test("guests can still browse, build a cart and get a quote (only placing the order needs an account)", async () => {
  assert.equal((await guest.get("/api/products")).status, 200);
  assert.equal((await guest.get("/api/config")).status, 200);
  const q = await guest.post("/api/cart/quote", { items: [item] });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  assert.ok(q.data.subtotal > 0);
});

test("existing orders can still be opened by guests with their token", async () => {
  const placed = await member.post("/api/orders", orderBody());
  assert.equal(placed.status, 201);
  const { reference } = placed.data.order;
  assert.equal((await guest.get(`/api/orders/${reference}`)).status, 404, "no token, no access");
  assert.equal((await guest.get(`/api/orders/${reference}?t=${placed.data.accessToken}`)).status, 200);
});
