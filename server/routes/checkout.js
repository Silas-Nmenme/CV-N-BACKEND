import { Router } from "express";
import { z } from "zod";
import { Order } from "../models/Order.js";
import { getSettings } from "../models/Misc.js";
import { optionalAuth, can } from "../middleware/auth.js";
import { strictLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, HttpError, normalizeNgPhone, safeEqual } from "../utils/helpers.js";
import { NIGERIAN_STATES, PAYMENT_METHODS } from "../utils/constants.js";
import { quote } from "../services/pricing.js";
import { deliveryOptions } from "../services/delivery.js";
import { createOrder, publicOrder } from "../services/orders.js";
import { availablePaymentMethods } from "../services/payments.js";

const router = Router();

const itemsSchema = z
  .array(z.object({ productId: z.string().length(24, "Invalid product."), sku: z.string().min(1).max(60), quantity: z.number().int().min(1).max(20) }))
  .min(1, "Your cart is empty.")
  .max(40);

/* Live pricing for the cart page (works for guests; nothing is stored). */
router.post(
  "/cart/quote",
  optionalAuth,
  validate({
    body: z.object({
      items: z.array(z.object({ productId: z.string().length(24), sku: z.string().min(1).max(60), quantity: z.number().int().min(1).max(20) })).max(40),
      couponCode: z.string().trim().max(40).optional(),
      state: z.string().trim().max(40).optional(),
      shippingMethod: z.string().trim().max(40).optional(),
      email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const state = NIGERIAN_STATES.includes(b.state) ? b.state : undefined;
    const q = await quote({ items: b.items, couponCode: b.couponCode, state, shippingMethod: b.shippingMethod, userId: req.user?._id, email: b.email || req.user?.email });
    const { lines, ...rest } = q;
    res.json({ success: true, lines, ...rest });
  })
);

router.get(
  "/delivery/options",
  asyncHandler(async (req, res) => {
    const state = String(req.query.state || "");
    if (!NIGERIAN_STATES.includes(state)) throw new HttpError(400, "Choose a Nigerian state.");
    const options = await deliveryOptions(state, Number(req.query.subtotal) || 0);
    res.json({ success: true, options, available: options.length > 0 });
  })
);

const phone = z.string().trim().transform((v, ctx) => {
  const n = normalizeNgPhone(v);
  if (!n) {
    ctx.addIssue({ code: "custom", message: "Enter a valid Nigerian phone number, e.g. 0803 123 4567." });
    return z.NEVER;
  }
  return n;
});

const checkoutBody = z.object({
  items: itemsSchema,
  customer: z.object({
    fullName: z.string().trim().min(2, "Enter your full name.").max(100),
    email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
    phone,
  }),
  shipping: z.object({
    state: z.enum(NIGERIAN_STATES, { errorMap: () => ({ message: "Choose your state." }) }),
    city: z.string().trim().min(2, "Enter your city or town.").max(80),
    address: z.string().trim().min(5, "Enter your full delivery address.").max(300),
    notes: z.string().trim().max(500).optional(),
    method: z.string().trim().min(1, "Choose a delivery method.").max(40),
  }),
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Choose a payment method." }) }),
  couponCode: z.string().trim().max(40).optional(),
});

router.post(
  "/orders",
  optionalAuth,
  strictLimiter,
  validate({ body: checkoutBody }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const methods = await availablePaymentMethods();
    if (!methods.includes(b.paymentMethod)) throw new HttpError(400, "That payment method is not available right now.");

    const q = await quote({
      items: b.items, couponCode: b.couponCode, state: b.shipping.state, shippingMethod: b.shipping.method,
      userId: req.user?._id, email: b.customer.email, strict: true,
    });
    if (q.shipping.pickup) {
      b.shipping.address = b.shipping.address || "Store pickup";
    }

    const { order, accessToken } = await createOrder({
      quoteResult: q, customer: b.customer, shippingInfo: b.shipping, paymentMethod: b.paymentMethod, user: req.user,
    });

    const settings = await getSettings();
    const bank = b.paymentMethod === "bank_transfer"
      ? { bankName: settings.payments.bankName, accountName: settings.payments.accountName, accountNumber: settings.payments.accountNumber, instructions: settings.payments.transferInstructions }
      : null;
    res.status(201).json({ success: true, order: publicOrder(order), accessToken, bank });
  })
);

/** Guests prove ownership with the per-order token; signed-in users own their orders; staff may view any. */
export async function loadOrderForRequest(req, reference, token) {
  const order = await Order.findOne({ reference }).select("+accessToken");
  if (!order) throw new HttpError(404, "Order not found.");
  const tokenOk = token && safeEqual(order.accessToken, token);
  const owner = req.user && order.user && String(order.user) === String(req.user._id);
  const staff = req.user && can(req.user, "orders:read");
  if (!tokenOk && !owner && !staff) throw new HttpError(404, "Order not found.");
  return order;
}

router.get(
  "/orders/:reference",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const order = await loadOrderForRequest(req, req.params.reference, req.query.t);
    res.json({ success: true, order: publicOrder(order) });
  })
);

router.post(
  "/orders/track",
  strictLimiter,
  validate({ body: z.object({ reference: z.string().trim().toUpperCase().min(6).max(40), contact: z.string().trim().min(3).max(254) }) }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ reference: req.body.reference });
    const c = req.body.contact.toLowerCase();
    const phoneN = normalizeNgPhone(req.body.contact);
    const ok = order && (order.customer.email === c || (phoneN && order.customer.phone === phoneN));
    if (!ok) throw new HttpError(404, "We couldn't find an order matching those details.");
    res.json({ success: true, order: publicOrder(order) });
  })
);

router.post(
  "/orders/:reference/transfer-notice",
  optionalAuth,
  strictLimiter,
  validate({ body: z.object({ t: z.string().max(100).optional(), senderName: z.string().trim().min(2, "Enter the name on the sending account.").max(100), note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => {
    const order = await loadOrderForRequest(req, req.params.reference, req.body.t);
    if (order.payment.method !== "bank_transfer") throw new HttpError(400, "This order is not a bank transfer order.");
    if (order.payment.status === "paid") throw new HttpError(409, "This order is already paid.");
    if (order.status !== "pending_payment") throw new HttpError(409, "This order is no longer awaiting payment.");
    order.payment.status = "awaiting_confirmation";
    order.payment.transferNote = `Sender: ${req.body.senderName}${req.body.note ? " — " + req.body.note : ""}`;
    order.statusHistory.push({ status: order.status, note: "Customer reported a bank transfer", by: "customer" });
    await order.save();
    res.json({ success: true, order: publicOrder(order), message: "Thanks! We'll confirm your transfer and update your order." });
  })
);

router.get(
  "/orders/:reference/receipt",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const order = await loadOrderForRequest(req, req.params.reference, req.query.t);
    if (order.payment.status !== "paid") throw new HttpError(409, "A receipt is available once payment is confirmed.");
    const s = await getSettings();
    res.json({ success: true, order: publicOrder(order), store: { name: s.store.name, email: s.store.email, phone: s.store.phone, address: s.store.address } });
  })
);

export default router;
