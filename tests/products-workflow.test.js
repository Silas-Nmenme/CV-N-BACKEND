import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { bootstrap, client, startGatewayStub } from "./helpers.js";

/**
 * Product workflow, end to end, against the real Express app and a real MongoDB (no mocked responses):
 * admin adds a product with uploaded pictures -> it shows on the storefront (cards, details, SEO page) ->
 * edits flow through -> hidden products can be previewed by staff only -> deletes are safe.
 */

let ctx, gw, admin, shop, customer, brandId, catId, Review;

const png = (color) => sharp({ create: { width: 900, height: 900, channels: 3, background: color } }).png().toBuffer();
async function uploadImages(colors) {
  const fd = new FormData();
  for (const [i, c] of colors.entries()) fd.append("images", new Blob([await png(c)], { type: "image/png" }), `p${i}.png`);
  const r = await admin.post("/api/admin/products/upload?folder=products", null, { raw: fd });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.images;
}
const body = (over = {}) => ({
  name: "Tecno Phantom X3", brand: brandId, category: catId, series: "Phantom", model: "X3",
  description: "A real description that came from the admin form.", highlights: ["Fast charging", "Great camera"],
  specs: { display: "6.7-inch" }, warranty: "6 months", network: "Dual SIM", tags: ["tecno"], images: [],
  variants: [
    { sku: "phx3-128-blk", attrs: { storage: "128GB", colour: "Black", condition: "Brand New" }, price: 450000, comparePrice: 500000, stock: 6, active: true },
    { sku: "phx3-256-blu", attrs: { storage: "256GB", colour: "Blue", condition: "Brand New" }, price: 520000, stock: 2, active: true },
  ],
  featured: true, bestseller: false, newArrival: true, onOffer: false, active: true, ...over,
});
const orderBody = (productId, sku, quantity = 1) => ({
  items: [{ productId, sku, quantity }],
  customer: { fullName: "Ada Obi", email: "ada@example.com", phone: "0803 123 4567" },
  shipping: { state: "Lagos", city: "Ikeja", address: "12 Allen Avenue", method: "standard" },
  paymentMethod: "paystack",
});

before(async () => {
  gw = await startGatewayStub();
  ctx = await bootstrap({ dbName: "cvg_test_products", gateway: gw });
  ({ Review } = await import("../server/models/Review.js"));
  admin = client(ctx.base);
  shop = client(ctx.base);
  customer = client(ctx.base);
  assert.equal((await admin.post("/api/auth/login", { email: "owner@test.ng", password: "Owner12345" })).status, 200);
  const r = await customer.post("/api/auth/register", { name: "Ada Obi", email: "ada@example.com", phone: "08031234567", password: "Passw0rd99" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  brandId = (await admin.get("/api/admin/brands")).data.items.find((b) => b.slug === "samsung")._id;
  catId = (await admin.get("/api/admin/categories")).data.items.find((c) => c.slug === "phones")._id;
});
after(async () => ctx.close());

test("a product added in the admin appears on the storefront with its pictures, variations and SEO page", async () => {
  const images = await uploadImages(["#2145f5", "#f55a21"]);
  assert.equal(images.length, 2);
  const created = await admin.post("/api/admin/products", body({ images }));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.item._id;
  const slug = created.data.item.slug;
  assert.equal(slug, "tecno-phantom-x3");

  // listing card: everything the product card renders comes from the database
  const list = await shop.get("/api/products?q=phantom");
  assert.equal(list.data.total, 1);
  const card = list.data.products[0];
  assert.equal(card.id, id);
  assert.equal(card.slug, slug);
  assert.equal(card.name, "Tecno Phantom X3");
  assert.equal(card.brandName, "Samsung");
  assert.equal(card.categoryName, "Phones");
  assert.equal(card.variantCount, 2, "two variations means the card offers 'Choose options'");
  assert.equal(card.minPrice, 450000);
  assert.equal(card.maxPrice, 520000);
  assert.equal(card.totalStock, 8);
  assert.ok(card.defaultSku);
  assert.ok(card.image, "card has a picture");
  assert.equal((await shop.get(card.image)).status, 200, "the card picture file is really served");

  // details page: the exact product that was clicked, with all of its variations and pictures
  const d = (await shop.get(`/api/products/${slug}`)).data.product;
  assert.equal(d.id, id);
  assert.equal(d.name, "Tecno Phantom X3");
  assert.equal(d.description, "A real description that came from the admin form.");
  assert.equal(d.images.length, 2);
  assert.deepEqual(d.variants.map((v) => v.sku).sort(), ["PHX3-128-BLK", "PHX3-256-BLU"]);
  assert.deepEqual(d.attrDefs.map((a) => a.key).includes("storage"), true);
  assert.equal(d.breadcrumb.at(-1).slug, "phones");

  // server-rendered share/SEO page used by /p/:slug
  const page = await shop.get(`/p/${slug}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /<title>Tecno Phantom X3 \|/);
  assert.match(page.data, /og:title/);
  assert.match(page.data, /"price":450000/);

  // a customer can really buy it: quote prices come from the database, quantity is honoured
  const q = await shop.post("/api/cart/quote", { items: [{ productId: id, sku: "PHX3-128-BLK", quantity: 2 }] });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  assert.equal(q.data.subtotal, 900000);
});

test("edits made in the admin reach the storefront, and the product URL does not change on rename", async () => {
  const cur = (await admin.get("/api/admin/products?q=phantom")).data.items[0];
  const edit = await admin.put(`/api/admin/products/${cur._id}`, body({
    name: "Tecno Phantom X3 Pro", description: "Updated copy.", images: cur.images,
    variants: [{ sku: "PHX3-128-BLK", attrs: { storage: "128GB", colour: "Black", condition: "Brand New" }, price: 430000, stock: 9, active: true }],
  }));
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(edit.data.item.slug, "tecno-phantom-x3", "renaming must not break existing links");

  const d = (await shop.get("/api/products/tecno-phantom-x3")).data.product;
  assert.equal(d.name, "Tecno Phantom X3 Pro");
  assert.equal(d.description, "Updated copy.");
  assert.equal(d.minPrice, 430000);
  assert.equal(d.totalStock, 9);
  assert.equal(d.variants.length, 1);

  // an explicit new slug is honoured
  const re = await admin.put(`/api/admin/products/${cur._id}`, body({ slug: "phantom-pro", name: "Tecno Phantom X3 Pro", images: cur.images }));
  assert.equal(re.data.item.slug, "phantom-pro");
  assert.equal((await shop.get("/api/products/phantom-pro")).status, 200);
});

test("hidden products can be previewed by signed-in staff only", async () => {
  const cur = (await admin.get("/api/admin/products?q=phantom")).data.items[0];
  await admin.patch(`/api/admin/products/${cur._id}/quick`, { active: false });
  const url = `/api/products/${cur.slug}`;

  assert.equal((await shop.get(url)).status, 404, "customers cannot see it");
  assert.equal((await shop.get(`${url}?preview=1`)).status, 404, "anonymous visitors cannot force a preview");
  assert.equal((await customer.get(`${url}?preview=1`)).status, 404, "signed-in customers cannot force a preview");

  const pv = await admin.get(`${url}?preview=1`);
  assert.equal(pv.status, 200);
  assert.equal(pv.data.product.name, "Tecno Phantom X3 Pro");
  assert.equal(pv.data.product.preview, true);
  assert.equal(pv.data.product.active, false);
  assert.match(pv.headers.get("cache-control") || "", /no-store/);

  // the shell page used for preview never contains product data and is not indexable
  const shell = await shop.get(`/p/${cur.slug}?preview=1`);
  assert.equal(shell.status, 200);
  assert.match(shell.data, /noindex/);
  assert.ok(!shell.data.includes("Tecno Phantom"), "no product data leaks through the preview shell");
  assert.equal((await shop.get(`/p/${cur.slug}`)).status, 404, "the public page still 404s while hidden");

  // an active product's response is unchanged by ?preview=1 (no preview flag)
  await admin.patch(`/api/admin/products/${cur._id}/quick`, { active: true });
  assert.equal((await shop.get(url)).data.product.preview, undefined);
});

test("image links are validated: only uploaded files or https links are accepted", async () => {
  const base = body({ name: "Link Test Phone", variants: [{ sku: "LT-1", attrs: {}, price: 1000, stock: 1, active: true }] });
  for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "/uploads/../../etc/passwd", "ftp://x/y.png"]) {
    const r = await admin.post("/api/admin/products", { ...base, images: [{ url: bad, thumb: "", alt: "", publicId: "" }] });
    assert.equal(r.status, 400, `rejects ${bad}`);
  }
  const ok = await admin.post("/api/admin/products", { ...base, images: [{ url: "https://res.cloudinary.com/demo/image/upload/a.webp", thumb: "https://res.cloudinary.com/demo/image/upload/a-t.webp", alt: "", publicId: "a|b" }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  await admin.del(`/api/admin/products/${ok.data.item._id}`);
});

test("deleting a product is safe: blocked while in an open order, and it cleans up after itself", async () => {
  const images = await uploadImages(["#00aa55"]);
  const a = (await admin.post("/api/admin/products", body({ name: "Delete Me Phone", model: "DM", images, variants: [{ sku: "DM-1", attrs: {}, price: 100000, stock: 5, active: true }] }))).data.item;
  const b = (await admin.post("/api/admin/products", body({ name: "Shares The Picture", model: "SP", images, variants: [{ sku: "SP-1", attrs: {}, price: 90000, stock: 5, active: true }] }))).data.item;

  // customer wishlists it, saves it in their cart and reviews it; then places an order
  assert.equal((await customer.post(`/api/account/wishlist/${a._id}`)).status, 200);
  assert.equal((await customer.put("/api/account/cart", { items: [{ productId: a._id, sku: "DM-1", quantity: 1 }] })).status, 200);
  await Review.create({ product: a._id, user: (await ctx.models.User.findOne({ email: "ada@example.com" }))._id, authorName: "Ada", rating: 5, title: "Good", body: "Works well, happy.", status: "approved" });
  assert.equal(await Review.countDocuments({ product: a._id }), 1, "review exists before the delete");
  const before = await ctx.models.User.findOne({ email: "ada@example.com" });
  assert.equal(before.wishlist.map(String).includes(String(a._id)), true, "wishlisted before the delete");
  assert.equal(before.cart.some((i) => String(i.productId) === String(a._id)), true, "in the saved cart before the delete");
  const placed = await customer.post("/api/orders", orderBody(a._id, "DM-1", 2));
  assert.equal(placed.status, 201, JSON.stringify(placed.data));

  let r = await admin.del(`/api/admin/products/${a._id}`);
  assert.equal(r.status, 409, "cannot delete a product that is in an open order");
  assert.match(r.data.message, /open order/);
  assert.equal((await admin.get(`/api/admin/products/${a._id}`)).status, 200, "the product is untouched");

  // once the order is finished the product can go
  const cancel = await admin.patch(`/api/admin/orders/${placed.data.order.reference}/status`, { status: "cancelled" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  r = await admin.del(`/api/admin/products/${a._id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const user = await ctx.models.User.findOne({ email: "ada@example.com" });
  assert.equal(user.wishlist.map(String).includes(String(a._id)), false, "removed from wishlists");
  assert.equal(user.cart.some((i) => String(i.productId) === String(a._id)), false, "removed from saved carts");
  assert.equal(await Review.countDocuments({ product: a._id }), 0, "its reviews are removed");
  const order = await ctx.models.Order.findOne({ reference: placed.data.order.reference }).lean();
  assert.equal(order.items[0].name, "Delete Me Phone", "order history keeps its own copy of the item");

  // the picture is shared with product b, so it must still be served
  assert.equal((await shop.get(images[0].url)).status, 200, "a picture still used by another product is kept");

  // deleting the last product that uses a picture removes the file too
  assert.equal((await admin.del(`/api/admin/products/${b._id}`)).status, 200);
  assert.equal((await shop.get(images[0].url)).status, 404, "an unused uploaded picture is removed");
});

test("storefront and admin product APIs are properly protected", async () => {
  assert.equal((await shop.post("/api/admin/products", body())).status, 401);
  assert.equal((await shop.get("/api/admin/products")).status, 401);
  assert.equal((await customer.post("/api/admin/products", body())).status, 403);
  assert.equal((await customer.get("/api/admin/products")).status, 403);
  assert.equal((await customer.del("/api/admin/products/000000000000000000000000")).status, 403);
  assert.equal((await shop.post("/api/admin/products/upload", null, { raw: new FormData() })).status, 401);
});
