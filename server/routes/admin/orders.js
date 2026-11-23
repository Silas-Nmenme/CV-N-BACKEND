import { Router } from "express";
import { z } from "zod";
import { Order } from "../../models/Order.js";
import { Payment } from "../../models/Payment.js";
import { requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler, HttpError, escapeRegex, paginate, normalizeNgPhone } from "../../utils/helpers.js";
import { ORDER_STATUSES } from "../../utils/constants.js";
import { cancelOrder, markOrderPaid, publicOrder } from "../../services/orders.js";
import { verifyPaymentByReference } from "../../services/payments.js";
import { sendStatusUpdate } from "../../services/mailer.js";
import { toKobo } from "../../utils/helpers.js";

const router = Router();
const read = requirePermission("orders:read");
const write = requirePermission("orders:update");

const TRANSITIONS = {
  pending_payment: ["cancelled"],
  confirmed: ["processing", "dispatched", "cancelled", "refunded"],
  processing: ["dispatched", "cancelled", "refunded"],
  dispatched: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function orderFilter(query) {
  const f = {};
  if (ORDER_STATUSES.includes(query.status)) f.status = query.status;
  if (query.paymentStatus) f["payment.status"] = query.paymentStatus;
  if (query.method) f["payment.method"] = query.method;
  if (query.q) {
    const q = String(query.q).trim().slice(0, 60);
    const rx = new RegExp(escapeRegex(q), "i");
    const phone = normalizeNgPhone(q);
    f.$or = [{ reference: rx }, { "customer.fullName": rx }, { "customer.email": rx }, ...(phone ? [{ "customer.phone": phone }] : [])];
  }
  const range = {};
  if (query.from && !Number.isNaN(Date.parse(query.from))) range.$gte = new Date(query.from);
  if (query.to && !Number.isNaN(Date.parse(query.to))) range.$lte = new Date(new Date(query.to).getTime() + 86399999);
  if (Object.keys(range).length) f.createdAt = range;
  return f;
}

router.get(
  "/",
  read,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = paginate(req.query, { defaultLimit: 20, maxLimit: 100 });
    const f = orderFilter(req.query);
    const [orders, total] = await Promise.all([Order.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit), Order.countDocuments(f)]);
    res.json({ success: true, orders: orders.map((o) => ({ ...publicOrder(o), id: String(o._id) })), total, page, pages: Math.ceil(total / limit) });
  })
);

router.get(
  "/export.csv",
  requirePermission("reports"),
  asyncHandler(async (req, res) => {
    const orders = await Order.find(orderFilter(req.query)).sort({ createdAt: -1 }).limit(5000);
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const rows = [["Reference", "Date", "Customer", "Email", "Phone", "State", "Items", "Subtotal", "Discount", "Delivery", "Total", "Payment method", "Payment status", "Order status"]];
    for (const o of orders) {
      rows.push([o.reference, o.createdAt.toISOString(), o.customer.fullName, o.customer.email, o.customer.phone, o.shipping.state, o.items.map((i) => `${i.name} x${i.quantity}`).join("; "), o.subtotal, o.discount, o.shippingFee, o.total, o.payment.method, o.payment.status, o.status]);
    }
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="orders.csv"' });
    res.send("\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n"));
  })
);

router.get(
  "/:reference",
  read,
  asyncHandler(async (req, res) => {
    const o = await Order.findOne({ reference: req.params.reference }).populate("user", "name email phone");
    if (!o) throw new HttpError(404, "Order not found.");
    const payments = await Payment.find({ order: o._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, order: { ...publicOrder(o), id: String(o._id), user: o.user, stockReserved: o.stockReserved, cancelReason: o.cancelReason }, payments });
  })
);

router.patch(
  "/:reference/status",
  write,
  validate({
    body: z.object({
      status: z.enum(ORDER_STATUSES),
      note: z.string().trim().max(500).optional(),
      courier: z.string().trim().max(80).optional(),
      trackingNumber: z.string().trim().max(80).optional(),
      trackingUrl: z.string().trim().url().max(300).optional().or(z.literal("")),
      refund: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const o = await Order.findOne({ reference: req.params.reference });
    if (!o) throw new HttpError(404, "Order not found.");
    const b = req.body;
    if (b.status === o.status) throw new HttpError(400, `The order is already ${o.status.replace("_", " ")}.`);
    if (!TRANSITIONS[o.status].includes(b.status)) throw new HttpError(409, `You can't move an order from "${o.status.replace("_", " ")}" to "${b.status.replace("_", " ")}".`);
    const by = req.user.email;

    if (b.status === "cancelled") {
      const updated = await cancelOrder(o, { reason: b.note || "Cancelled by staff", by });
      if (o.payment.status === "paid") {
        await Order.updateOne({ _id: o._id }, { $set: { ...(b.refund ? { "payment.status": "refunded" } : {}) }, $push: { statusHistory: { status: "cancelled", note: b.refund ? "Payment marked as refunded." : "Paid order cancelled — remember to refund the customer.", by, at: new Date() } } });
      }
      return res.json({ success: true, order: publicOrder(await Order.findById(updated._id)) });
    }

    if (["processing", "dispatched", "delivered", "confirmed"].includes(b.status) && o.payment.status !== "paid") {
      throw new HttpError(409, "Confirm payment before moving this order forward.");
    }
    const set = { status: b.status };
    if (b.status === "dispatched") {
      if (!b.courier && !o.dispatch?.courier) throw new HttpError(400, "Add the courier or rider handling this delivery.");
      Object.assign(set, { "dispatch.courier": b.courier ?? o.dispatch.courier, "dispatch.trackingNumber": b.trackingNumber ?? "", "dispatch.trackingUrl": b.trackingUrl ?? "", "dispatch.dispatchedAt": new Date(), "dispatch.note": b.note || "" });
    }
    if (b.status === "delivered") set["dispatch.deliveredAt"] = new Date();
    if (b.status === "refunded") set["payment.status"] = "refunded";
    const updated = await Order.findOneAndUpdate({ _id: o._id, status: o.status }, { $set: set, $push: { statusHistory: { status: b.status, note: b.note || "", by, at: new Date() } } }, { new: true });
    if (!updated) throw new HttpError(409, "This order was just updated by someone else. Refresh and try again.");
    if (b.status === "refunded" && updated.stockReserved === false) {
      // Returned goods: staff restock manually from the product page after inspection.
    }
    sendStatusUpdate(updated, b.note).catch(() => {});
    res.json({ success: true, order: publicOrder(updated) });
  })
);

/** Re-check a gateway payment directly with Paystack/Flutterwave. */
router.post(
  "/:reference/verify-payment",
  write,
  asyncHandler(async (req, res) => {
    const o = await Order.findOne({ reference: req.params.reference });
    if (!o) throw new HttpError(404, "Order not found.");
    const latest = await Payment.findOne({ order: o._id, provider: { $in: ["paystack", "flutterwave"] } }).sort({ createdAt: -1 });
    if (!latest) throw new HttpError(404, "No online payment attempt exists for this order.");
    const r = await verifyPaymentByReference(latest.reference, { by: req.user.email });
    res.json({ success: true, status: r.status, order: publicOrder(await Order.findById(o._id)) });
  })
);

/** Manual confirmation: only for bank transfers (or payments held for review). */
router.post(
  "/:reference/confirm-payment",
  write,
  validate({ body: z.object({ amountReceived: z.number().min(0), note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => {
    const o = await Order.findOne({ reference: req.params.reference });
    if (!o) throw new HttpError(404, "Order not found.");
    if (o.payment.status === "paid") throw new HttpError(409, "This order is already paid.");
    const manualOk = o.payment.method === "bank_transfer" || o.payment.status === "awaiting_confirmation";
    if (!manualOk) throw new HttpError(409, "Online payments are confirmed automatically by the gateway. Use “Re-check payment” instead.");
    if (toKobo(req.body.amountReceived) !== toKobo(o.total)) {
      throw new HttpError(400, `The amount received must equal the order total (₦${o.total.toLocaleString("en-NG")}). If the customer underpaid or overpaid, resolve that first.`);
    }
    const out = await markOrderPaid(o, { amountKobo: toKobo(req.body.amountReceived), channel: "bank_transfer", by: req.user.email });
    if (req.body.note) await Order.updateOne({ _id: o._id }, { $push: { statusHistory: { status: out.order.status, note: req.body.note, by: req.user.email, at: new Date() } } });
    res.json({ success: true, order: publicOrder(await Order.findById(o._id)) });
  })
);

export default router;
