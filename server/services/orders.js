import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { Coupon } from "../models/Coupon.js";
import { Payment } from "../models/Payment.js";
import { env } from "../config/env.js";
import { HttpError, orderReference, randomToken, toKobo } from "../utils/helpers.js";
import { sendOrderConfirmation, sendOrderPlaced, sendStatusUpdate } from "./mailer.js";

/** Atomically take stock for every line, or take nothing. */
export async function reserveStock(lines) {
  const done = [];
  for (const l of lines) {
    const r = await Product.updateOne(
      { _id: l.productId, variants: { $elemMatch: { sku: l.sku, active: { $ne: false }, stock: { $gte: l.quantity } } } },
      { $inc: { "variants.$.stock": -l.quantity, totalStock: -l.quantity } }
    );
    if (r.modifiedCount !== 1) {
      await restoreStock(done);
      throw new HttpError(409, `Sorry, ${l.name} just sold out or has less stock than you asked for. Please review your cart.`);
    }
    done.push(l);
  }
}

export async function restoreStock(lines) {
  for (const l of lines) {
    await Product.updateOne(
      { _id: l.productId || l.product, "variants.sku": l.sku },
      { $inc: { "variants.$.stock": l.quantity, totalStock: l.quantity } }
    );
  }
}

async function releaseCoupon(order) {
  if (order.couponCode) await Coupon.updateOne({ code: order.couponCode, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
}

export async function createOrder({ quoteResult, customer, shippingInfo, paymentMethod, user }) {
  const q = quoteResult;
  await reserveStock(q.lines);

  let couponTaken = false;
  try {
    if (q.coupon) {
      const r = await Coupon.findOneAndUpdate({ _id: q.coupon.couponId }, { $inc: { usedCount: 1 } }, { new: true });
      if (r?.usageLimit != null && r.usedCount > r.usageLimit) {
        await Coupon.updateOne({ _id: r._id }, { $inc: { usedCount: -1 } });
        throw new HttpError(400, "That coupon has just reached its usage limit.");
      }
      couponTaken = true;
    }

    const holdMs = (paymentMethod === "bank_transfer" ? env.bankTransferHoldHours * 60 : env.pendingOrderMinutes) * 60 * 1000;
    const accessToken = randomToken(16);
    const reference = orderReference();

    const order = await Order.create({
      reference,
      accessToken,
      user: user?._id || null,
      items: q.lines.map((l) => ({
        product: l.productId,
        sku: l.sku,
        name: l.name,
        brandName: l.brandName,
        slug: l.slug,
        image: l.image,
        attrs: l.attrs,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
      })),
      subtotal: q.subtotal,
      discount: q.discount,
      couponCode: q.coupon?.code || "",
      shippingFee: q.shippingFee,
      total: q.total,
      customer,
      shipping: {
        method: q.shipping.code,
        methodName: q.shipping.name,
        zoneName: q.shipping.zone,
        etaText: q.shipping.eta,
        state: shippingInfo.state,
        city: shippingInfo.city,
        address: shippingInfo.address,
        notes: shippingInfo.notes || "",
        pickup: Boolean(q.shipping.pickup),
      },
      payment: { method: paymentMethod, status: "pending" },
      status: "pending_payment",
      statusHistory: [{ status: "pending_payment", note: "Order placed", by: "customer" }],
      stockReserved: true,
      expiresAt: new Date(Date.now() + holdMs),
    });
    sendOrderPlaced(order).catch(() => {});
    return { order, accessToken };
  } catch (err) {
    await restoreStock(q.lines);
    if (couponTaken) await Coupon.updateOne({ _id: q.coupon.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    throw err;
  }
}

/** Give reserved stock (and the coupon use) back; safe to call more than once. */
export async function releaseOrderStock(order) {
  const claimed = await Order.findOneAndUpdate({ _id: order._id, stockReserved: true }, { $set: { stockReserved: false } });
  if (!claimed) return false;
  await restoreStock(order.items.map((i) => ({ productId: i.product, sku: i.sku, quantity: i.quantity })));
  await releaseCoupon(order);
  return true;
}

export async function cancelOrder(order, { reason = "", by = "system", status = "cancelled" } = {}) {
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: { $in: ["pending_payment", "confirmed", "processing"] } },
    {
      $set: { status, cancelReason: reason },
      $push: { statusHistory: { status, note: reason, by, at: new Date() } },
    },
    { new: true }
  );
  if (!updated) throw new HttpError(409, "This order can no longer be cancelled.");
  await releaseOrderStock(updated);
  if (updated.payment.status === "pending" || updated.payment.status === "awaiting_confirmation") {
    await Order.updateOne({ _id: updated._id }, { $set: { "payment.status": "failed" } });
  }
  await Payment.updateMany({ order: updated._id, status: "initiated" }, { $set: { status: "abandoned" } });
  sendStatusUpdate(updated, reason).catch(() => {});
  return updated;
}

/**
 * Record a verified payment. Idempotent: the same payment arriving via redirect AND
 * webhook only confirms the order once.
 */
export async function markOrderPaid(order, { amountKobo, transactionId = "", channel = "", providerRef = "", by = "gateway" }) {
  const expectedKobo = toKobo(order.total);
  if (amountKobo !== expectedKobo) {
    await Order.updateOne(
      { _id: order._id, "payment.status": { $in: ["pending", "awaiting_confirmation"] } },
      {
        $set: { "payment.status": "awaiting_confirmation", "payment.transferNote": `Amount mismatch: received ${amountKobo / 100}, expected ${order.total}. Review before confirming.` },
        $push: { statusHistory: { status: order.status, note: "Payment amount did not match order total; held for manual review.", by, at: new Date() } },
      }
    );
    throw new HttpError(409, "The amount paid does not match this order. Our team will review it.");
  }

  const now = new Date();
  const paid = await Order.findOneAndUpdate(
    { _id: order._id, "payment.status": { $ne: "paid" } },
    {
      $set: {
        "payment.status": "paid",
        "payment.paidAt": now,
        "payment.amountPaid": order.total,
        "payment.providerTransactionId": transactionId,
        "payment.channel": channel,
        "payment.reference": providerRef || order.payment.reference,
        "payment.confirmedBy": by,
        receiptNumber: `RCP-${order.reference.slice(4)}`,
      },
    },
    { new: true }
  );
  if (!paid) return { order, alreadyPaid: true };

  let note = "Payment confirmed";
  let nextStatus = paid.status === "pending_payment" ? "confirmed" : paid.status;

  if (paid.status === "cancelled") {
    // Money arrived after we released the stock. Try to take it back.
    try {
      await reserveStock(paid.items.map((i) => ({ productId: i.product, sku: i.sku, quantity: i.quantity, name: i.name })));
      await Order.updateOne({ _id: paid._id }, { $set: { stockReserved: true } });
      nextStatus = "confirmed";
      note = "Payment received after the order expired; stock was available again, so the order was reinstated.";
    } catch {
      nextStatus = "cancelled";
      note = "Payment received after the order expired and stock is no longer available. REFUND REQUIRED.";
    }
  }

  const final = await Order.findOneAndUpdate(
    { _id: paid._id },
    { $set: { status: nextStatus, expiresAt: null }, $push: { statusHistory: { status: nextStatus, note, by, at: now } } },
    { new: true }
  );

  await Promise.all(
    final.items.map((i) => Product.updateOne({ _id: i.product }, { $inc: { soldCount: i.quantity } }))
  );
  if (nextStatus !== "cancelled") sendOrderConfirmation(final).catch(() => {});
  return { order: final, alreadyPaid: false };
}

/** Release stock for unpaid orders whose hold has expired. */
export async function expireStaleOrders() {
  const stale = await Order.find({ status: "pending_payment", "payment.status": "pending", expiresAt: { $lt: new Date() } }).limit(50);
  let n = 0;
  for (const o of stale) {
    try {
      await cancelOrder(o, { reason: "Payment not completed in time", by: "system" });
      n++;
    } catch {
      /* already moved on */
    }
  }
  return n;
}

export function publicOrder(o, { includeToken = false } = {}) {
  const obj = o.toObject ? o.toObject() : o;
  const out = {
    reference: obj.reference,
    status: obj.status,
    statusHistory: obj.statusHistory,
    items: obj.items,
    subtotal: obj.subtotal,
    discount: obj.discount,
    couponCode: obj.couponCode,
    shippingFee: obj.shippingFee,
    total: obj.total,
    currency: obj.currency,
    customer: obj.customer,
    shipping: obj.shipping,
    payment: {
      method: obj.payment.method,
      status: obj.payment.status,
      paidAt: obj.payment.paidAt,
      channel: obj.payment.channel,
      transferNote: obj.payment.transferNote,
    },
    dispatch: obj.dispatch,
    receiptNumber: obj.receiptNumber,
    createdAt: obj.createdAt,
    expiresAt: obj.expiresAt,
  };
  if (includeToken) out.accessToken = obj.accessToken;
  return out;
}
