import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { z } from "zod";
import { User } from "../models/User.js";
import { Product } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { requireAuth, issueSession } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, HttpError, normalizeNgPhone } from "../utils/helpers.js";
import { NIGERIAN_STATES } from "../utils/constants.js";
import { passwordRule, sessionPayload } from "./auth.js";
import { publicOrder, cancelOrder } from "../services/orders.js";
import { priceLines } from "../services/pricing.js";

const router = Router();
router.use(requireAuth);

const phone = z.string().trim().transform((v, ctx) => {
  const n = normalizeNgPhone(v);
  if (!n) {
    ctx.addIssue({ code: "custom", message: "Enter a valid Nigerian phone number, e.g. 0803 123 4567." });
    return z.NEVER;
  }
  return n;
});

const addressBody = z.object({
  label: z.string().trim().max(40).optional(),
  fullName: z.string().trim().min(2, "Enter the recipient's name.").max(100),
  phone,
  state: z.enum(NIGERIAN_STATES, { errorMap: () => ({ message: "Choose a Nigerian state." }) }),
  city: z.string().trim().min(2, "Enter the city or town.").max(80),
  address: z.string().trim().min(5, "Enter the full delivery address.").max(300),
  isDefault: z.boolean().optional(),
});

/* ------------------------------- profile -------------------------------- */
router.patch(
  "/profile",
  validate({ body: z.object({ name: z.string().trim().min(2).max(100).optional(), phone: phone.optional().or(z.literal("").transform(() => "")) }) }),
  asyncHandler(async (req, res) => {
    if (req.body.name !== undefined) req.user.name = req.body.name;
    if (req.body.phone !== undefined) req.user.phone = req.body.phone;
    await req.user.save();
    res.json({ success: true, user: sessionPayload(req.user) });
  })
);

router.post(
  "/change-password",
  validate({ body: z.object({ currentPassword: z.string().min(1, "Enter your current password."), newPassword: passwordRule }) }),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select("+passwordHash");
    if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw new HttpError(400, "Your current password is incorrect.");
    user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();
    issueSession(res, user);
    res.json({ success: true, message: "Password changed." });
  })
);

/* ------------------------------- addresses ------------------------------ */
router.get("/addresses", (req, res) => res.json({ success: true, addresses: req.user.addresses }));

router.post(
  "/addresses",
  validate({ body: addressBody }),
  asyncHandler(async (req, res) => {
    if (req.user.addresses.length >= 10) throw new HttpError(400, "You can save up to 10 addresses.");
    if (req.body.isDefault || req.user.addresses.length === 0) req.user.addresses.forEach((a) => (a.isDefault = false));
    req.user.addresses.push({ ...req.body, isDefault: req.body.isDefault || req.user.addresses.length === 0 });
    await req.user.save();
    res.status(201).json({ success: true, addresses: req.user.addresses });
  })
);

router.put(
  "/addresses/:id",
  validate({ body: addressBody }),
  asyncHandler(async (req, res) => {
    const addr = req.user.addresses.id(req.params.id);
    if (!addr) throw new HttpError(404, "Address not found.");
    if (req.body.isDefault) req.user.addresses.forEach((a) => (a.isDefault = false));
    addr.set(req.body);
    await req.user.save();
    res.json({ success: true, addresses: req.user.addresses });
  })
);

router.delete(
  "/addresses/:id",
  asyncHandler(async (req, res) => {
    const addr = req.user.addresses.id(req.params.id);
    if (!addr) throw new HttpError(404, "Address not found.");
    const wasDefault = addr.isDefault;
    addr.deleteOne();
    if (wasDefault && req.user.addresses.length) req.user.addresses[0].isDefault = true;
    await req.user.save();
    res.json({ success: true, addresses: req.user.addresses });
  })
);

/* -------------------------------- wishlist ------------------------------ */
async function wishlistPayload(user) {
  const products = await Product.find({ _id: { $in: user.wishlist }, active: true }).lean();
  return products.map(cardShape);
}

export function cardShape(p) {
  return {
    id: String(p._id),
    slug: p.slug,
    name: p.name,
    brandName: p.brandName,
    categoryName: p.categoryName,
    image: p.images?.[0]?.thumb || p.images?.[0]?.url || "",
    imageAlt: p.images?.[0]?.alt || p.name,
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    maxDiscountPct: p.maxDiscountPct,
    totalStock: p.totalStock,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    featured: p.featured,
    newArrival: p.newArrival,
    bestseller: p.bestseller,
    onOffer: p.onOffer,
    summary: summaryLine(p),
    defaultSku: (p.variants.find((v) => v.active !== false && v.stock > 0) || p.variants[0])?.sku,
    variantCount: p.variants.filter((v) => v.active !== false).length,
  };
}

function summaryLine(p) {
  const v = p.variants.find((x) => x.active !== false && x.stock > 0) || p.variants[0];
  const parts = [];
  if (v?.attrs?.storage) parts.push(v.attrs.storage);
  if (v?.attrs?.ram) parts.push(v.attrs.ram);
  if (p.specs?.processor) parts.push(p.specs.processor);
  if (v?.attrs?.condition) parts.push(v.attrs.condition);
  if (!parts.length && p.specs?.wattage) parts.push(`${p.specs.wattage}W`);
  if (!parts.length && p.specs?.connector) parts.push(p.specs.connector);
  return parts.join(" · ");
}

router.get("/wishlist", asyncHandler(async (req, res) => res.json({ success: true, products: await wishlistPayload(req.user), ids: req.user.wishlist.map(String) })));

router.post(
  "/wishlist/:productId",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.productId) || !(await Product.exists({ _id: req.params.productId, active: true }))) throw new HttpError(404, "Product not found.");
    await User.updateOne({ _id: req.user._id }, { $addToSet: { wishlist: req.params.productId } });
    const u = await User.findById(req.user._id);
    res.json({ success: true, ids: u.wishlist.map(String) });
  })
);

router.delete(
  "/wishlist/:productId",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.productId)) throw new HttpError(400, "Invalid product.");
    await User.updateOne({ _id: req.user._id }, { $pull: { wishlist: req.params.productId } });
    const u = await User.findById(req.user._id);
    res.json({ success: true, ids: u.wishlist.map(String) });
  })
);

/* ----------------------------------- cart ------------------------------- */
const cartBody = z.object({
  items: z.array(z.object({ productId: z.string().length(24), sku: z.string().min(1).max(60), quantity: z.number().int().min(1).max(20) })).max(50),
});

router.get(
  "/cart",
  asyncHandler(async (req, res) => {
    res.json({ success: true, items: req.user.cart.map((i) => ({ productId: String(i.productId), sku: i.sku, quantity: i.quantity })) });
  })
);

// Replace the saved cart. The client merges guest + saved items before sending.
router.put(
  "/cart",
  validate({ body: cartBody }),
  asyncHandler(async (req, res) => {
    const { lines } = await priceLines(req.body.items);
    const valid = new Set(lines.map((l) => `${l.productId}:${l.sku}`));
    req.user.cart = req.body.items.filter((i) => valid.has(`${i.productId}:${i.sku}`));
    await req.user.save();
    res.json({ success: true, items: req.user.cart.map((i) => ({ productId: String(i.productId), sku: i.sku, quantity: i.quantity })) });
  })
);

/* ---------------------------------- orders ------------------------------ */
router.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, orders: orders.map((o) => publicOrder(o)) });
  })
);

router.get(
  "/orders/:reference",
  asyncHandler(async (req, res) => {
    const o = await Order.findOne({ reference: req.params.reference, user: req.user._id });
    if (!o) throw new HttpError(404, "Order not found.");
    res.json({ success: true, order: publicOrder(o) });
  })
);

router.post(
  "/orders/:reference/cancel",
  validate({ body: z.object({ reason: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => {
    const o = await Order.findOne({ reference: req.params.reference, user: req.user._id });
    if (!o) throw new HttpError(404, "Order not found.");
    if (o.status !== "pending_payment" || o.payment.status === "paid") {
      throw new HttpError(409, "Only unpaid orders can be cancelled online. Please contact us for help with paid orders.");
    }
    const updated = await cancelOrder(o, { reason: req.body.reason || "Cancelled by customer", by: "customer" });
    res.json({ success: true, order: publicOrder(updated) });
  })
);

export default router;
