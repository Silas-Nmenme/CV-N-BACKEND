import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootstrap, client, startGatewayStub } from "./helpers.js";

// Vercel Hobby only allows a daily cron, so expired unpaid orders are also released when shoppers use the store.
process.env.SWEEP_MIN_GAP_MS = "0"; // no throttle in this test file

let ctx, gw, admin, shop, brandId, catId;
const orderBody = (productId, sku) => ({
  items: [{ productId, sku, quantity: 1 }],
  customer: { fullName: "Ada Obi", email: "ada@example.com", phone: "0803 123 4567" },
  shipping: { state: "Lagos", city: "Ikeja", address: "12 Allen Avenue", method: "standard" },
  paymentMethod: "paystack",
});
const mk = async (name, sku) => (await admin.post("/api/admin/products", {
  name, brand: brandId, category: catId, description: "d", highlights: [], specs: {}, tags: [], images: [],
  variants: [{ sku, attrs: {}, price: 50000, stock: 1, active: true }], active: true,
})).data.item;

before(async () => {
  gw = await startGatewayStub();
  ctx = await bootstrap({ dbName: "cvg_test_lazy", gateway: gw });
  admin = client(ctx.base); shop = client(ctx.base);
  await admin.post("/api/auth/login", { email: "owner@test.ng", password: "Owner12345" });
  brandId = (await admin.get("/api/admin/brands")).data.items.find((b) => b.slug === "samsung")._id;
  catId = (await admin.get("/api/admin/categories")).data.items.find((c) => c.slug === "phones")._id;
});
after(async () => ctx.close());

test("stock held by an expired unpaid order is released when the next shopper views the store", async () => {
  const gone = await mk("Last Unit Phone", "LU-1");
  const live = await mk("Fresh Hold Phone", "FH-1");

  const a = await shop.post("/api/orders", orderBody(gone._id, "LU-1"));
  const b = await shop.post("/api/orders", orderBody(live._id, "FH-1"));
  assert.equal(a.status, 201, JSON.stringify(a.data)); assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.equal((await ctx.models.Product.findById(gone._id)).totalStock, 0, "the last unit is held by the unpaid order");

  // the hold runs out (nobody paid), but no cron has run
  await ctx.models.Order.updateOne({ reference: a.data.order.reference }, { expiresAt: new Date(Date.now() - 1000) });

  const page = await shop.get(`/api/products/${gone.slug}`);
  assert.equal(page.status, 200);
  assert.equal(page.data.product.totalStock, 1, "the unit is back on sale as soon as the page is viewed");
  assert.equal((await ctx.models.Order.findOne({ reference: a.data.order.reference })).status, "cancelled");

  // an order that has NOT expired is left alone
  assert.equal((await ctx.models.Order.findOne({ reference: b.data.order.reference })).status, "pending_payment");
  assert.equal((await ctx.models.Product.findById(live._id)).totalStock, 0);
});
