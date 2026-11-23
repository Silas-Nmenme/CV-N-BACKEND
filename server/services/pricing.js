import mongoose from "mongoose";
import { Product } from "../models/Product.js";
import { Coupon } from "../models/Coupon.js";
import { Order } from "../models/Order.js";
import { ancestorIds } from "./categories.js";
import { resolveDelivery } from "./delivery.js";
import { toKobo, fromKobo, HttpError } from "../utils/helpers.js";

const MAX_LINE_QTY = 10;

/** Resolve cart lines against live product data. Prices NEVER come from the client. */
export async function priceLines(items) {
  const ids = [...new Set(items.map((i) => i.productId))].filter((id) => mongoose.isValidObjectId(id));
  const products = await Product.find({ _id: { $in: ids }, active: true }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const lines = [];
  const issues = [];

  for (const it of items) {
    const p = byId.get(String(it.productId));
    if (!p) {
      issues.push({ productId: it.productId, sku: it.sku, type: "unavailable", message: "This product is no longer available." });
      continue;
    }
    const v = p.variants.find((x) => x.sku === it.sku && x.active !== false);
    if (!v) {
      issues.push({ productId: it.productId, sku: it.sku, type: "unavailable", message: `${p.name} (this option) is no longer available.` });
      continue;
    }
    let qty = Math.min(MAX_LINE_QTY, Math.max(1, Math.floor(Number(it.quantity) || 1)));
    if (v.stock <= 0) {
      issues.push({ productId: it.productId, sku: it.sku, type: "out_of_stock", message: `${p.name} is out of stock.` });
      continue;
    }
    if (qty > v.stock) {
      issues.push({ productId: it.productId, sku: it.sku, type: "reduced", message: `Only ${v.stock} of ${p.name} left in stock.` });
      qty = v.stock;
    }
    const image = v.image || p.images?.[0]?.thumb || p.images?.[0]?.url || "";
    lines.push({
      productId: String(p._id),
      categoryId: String(p.category),
      sku: v.sku,
      name: p.name,
      slug: p.slug,
      brandName: p.brandName,
      attrs: v.attrs || {},
      image,
      unitPrice: v.price,
      comparePrice: v.comparePrice && v.comparePrice > v.price ? v.comparePrice : null,
      quantity: qty,
      stock: v.stock,
      lineTotal: fromKobo(toKobo(v.price) * qty),
    });
  }
  return { lines, issues };
}

/** Validate a coupon against a set of priced lines. Returns the discount in naira. */
export async function evaluateCoupon(code, lines, { userId, email } = {}) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return null;
  const coupon = await Coupon.findOne({ code: clean }).lean();
  const now = new Date();
  const bad = (msg) => new HttpError(400, msg);
  if (!coupon || !coupon.active) throw bad("That coupon code is not valid.");
  if (coupon.startsAt && coupon.startsAt > now) throw bad("That coupon is not active yet.");
  if (coupon.expiresAt && coupon.expiresAt < now) throw bad("That coupon has expired.");
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw bad("That coupon has reached its usage limit.");

  let eligible = lines;
  if (coupon.categories?.length) {
    const allowed = new Set(coupon.categories.map(String));
    const cache = new Map();
    eligible = [];
    for (const l of lines) {
      if (!cache.has(l.categoryId)) cache.set(l.categoryId, await ancestorIds(l.categoryId));
      if (cache.get(l.categoryId).some((id) => allowed.has(id))) eligible.push(l);
    }
    if (!eligible.length) throw bad("That coupon does not apply to the items in your cart.");
  }
  const eligibleKobo = eligible.reduce((s, l) => s + toKobo(l.lineTotal), 0);
  if (eligibleKobo < toKobo(coupon.minSubtotal || 0)) {
    throw bad(`Spend at least ₦${Number(coupon.minSubtotal).toLocaleString("en-NG")} to use this coupon.`);
  }

  if (coupon.perUserLimit != null && coupon.perUserLimit > 0 && (userId || email)) {
    const who = userId ? { user: userId } : { "customer.email": String(email).toLowerCase() };
    const used = await Order.countDocuments({ ...who, couponCode: coupon.code, status: { $nin: ["cancelled"] } });
    if (used >= coupon.perUserLimit) throw bad("You have already used this coupon.");
  }

  let discountKobo = coupon.type === "percent" ? Math.round((eligibleKobo * coupon.value) / 100) : toKobo(coupon.value);
  if (coupon.type === "percent" && coupon.maxDiscount != null) discountKobo = Math.min(discountKobo, toKobo(coupon.maxDiscount));
  discountKobo = Math.min(discountKobo, eligibleKobo);
  return {
    couponId: coupon._id,
    code: coupon.code,
    description: coupon.description,
    type: coupon.type,
    value: coupon.value,
    discount: fromKobo(discountKobo),
  };
}

/**
 * Full server-side quote: lines, coupon, delivery and total.
 * `strict` throws on any stock/availability problem (used when placing an order).
 */
export async function quote({ items, couponCode, state, shippingMethod, userId, email, strict = false }) {
  const { lines, issues } = await priceLines(items || []);
  if (strict && (issues.length || !lines.length)) {
    throw new HttpError(409, issues[0]?.message || "Your cart is empty.", { issues });
  }
  const subtotalKobo = lines.reduce((s, l) => s + toKobo(l.lineTotal), 0);

  let coupon = null;
  let couponError = null;
  if (couponCode) {
    try {
      coupon = await evaluateCoupon(couponCode, lines, { userId, email });
    } catch (e) {
      if (strict || !(e instanceof HttpError)) throw e;
      couponError = e.message;
    }
  }
  const discountKobo = coupon ? toKobo(coupon.discount) : 0;
  const afterDiscount = fromKobo(subtotalKobo - discountKobo);

  let shipping = null;
  let deliveryOptions = [];
  let deliveryUnavailable = false;
  if (state) {
    const r = await resolveDelivery(state, shippingMethod, afterDiscount);
    deliveryOptions = r.options;
    if (r.error) deliveryUnavailable = true;
    else if (r.chosen) shipping = r.chosen;
    else if (strict) throw new HttpError(400, "Please choose a delivery method.");
  }
  if (strict && !shipping) throw new HttpError(400, deliveryUnavailable ? `We don't deliver to ${state} online yet. Please contact us on WhatsApp.` : "Please choose a delivery method.");

  const shippingKobo = shipping ? toKobo(shipping.fee) : 0;
  return {
    lines,
    issues,
    subtotal: fromKobo(subtotalKobo),
    discount: fromKobo(discountKobo),
    coupon,
    couponError,
    shipping,
    deliveryOptions,
    deliveryUnavailable,
    shippingFee: fromKobo(shippingKobo),
    total: fromKobo(subtotalKobo - discountKobo + shippingKobo),
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  };
}
