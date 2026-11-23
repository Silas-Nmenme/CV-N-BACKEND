import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { getSettings } from "../models/Misc.js";
import { env, paystackEnabled, flutterwaveEnabled } from "../config/env.js";
import { HttpError } from "../utils/helpers.js";
import { paystack, flutterwave } from "./gateways.js";
import { markOrderPaid } from "./orders.js";

export async function availablePaymentMethods() {
  const s = (await getSettings()).payments;
  const methods = [];
  if (s.paystack && paystackEnabled()) methods.push("paystack");
  if (s.flutterwave && flutterwaveEnabled()) methods.push("flutterwave");
  if (s.bankTransfer && s.accountNumber && s.bankName) methods.push("bank_transfer");
  return methods;
}

/** Start (or restart) an online payment attempt for an unpaid order. */
export async function initializePayment(order, provider) {
  if (order.payment.status === "paid") throw new HttpError(409, "This order is already paid.");
  if (!["pending_payment"].includes(order.status)) throw new HttpError(409, "This order can no longer be paid.");
  if (!order.stockReserved) throw new HttpError(409, "This order expired. Please place it again.");

  const methods = await availablePaymentMethods();
  if (!methods.includes(provider)) throw new HttpError(400, "That payment method is not available right now.");

  const attempt = (await Payment.countDocuments({ order: order._id })) + 1;
  const reference = `${order.reference}-P${attempt}`;
  const settings = await getSettings();
  const callbackUrl = `${env.appUrl}/payment-result?order=${encodeURIComponent(order.reference)}`;
  let url;

  if (provider === "paystack") {
    const r = await paystack.initialize({
      email: order.customer.email,
      amount: order.total,
      reference,
      callbackUrl,
      metadata: { orderReference: order.reference, custom_fields: [{ display_name: "Order", variable_name: "order", value: order.reference }] },
    });
    url = r.url;
  } else {
    const r = await flutterwave.initialize({
      email: order.customer.email,
      name: order.customer.fullName,
      phone: order.customer.phone,
      amount: order.total,
      reference,
      redirectUrl: callbackUrl,
      title: settings.store.name,
    });
    url = r.url;
  }

  await Payment.create({
    order: order._id,
    orderReference: order.reference,
    provider,
    reference,
    amount: order.total,
    events: [{ type: "initiated", note: `${provider} payment started` }],
  });
  await Order.updateOne({ _id: order._id }, { $set: { "payment.method": provider, "payment.reference": reference } });
  return { url, reference };
}

/**
 * Ask the provider what really happened to a payment, then update our records.
 * This is the ONLY path (besides an admin confirming a transfer) that marks an order paid.
 */
export async function verifyPaymentByReference(reference, { by = "gateway" } = {}) {
  const payment = await Payment.findOne({ reference });
  if (!payment) throw new HttpError(404, "Payment not found.");
  const order = await Order.findById(payment.order);
  if (!order) throw new HttpError(404, "Order not found.");

  if (payment.status === "success" && order.payment.status === "paid") return { order, payment, status: "success" };

  const gw = payment.provider === "paystack" ? paystack : payment.provider === "flutterwave" ? flutterwave : null;
  if (!gw) throw new HttpError(400, "This payment is not verified through a gateway.");
  const result = await gw.verify(reference);

  if (!result.found) {
    return { order, payment, status: "pending" };
  }
  if (result.reference && result.reference !== reference) throw new HttpError(409, "Payment reference mismatch.");

  if (result.success) {
    if (result.currency !== "NGN") {
      payment.status = "failed";
      payment.gatewayMessage = `Unexpected currency ${result.currency}`;
      await payment.save();
      throw new HttpError(409, "Payment currency does not match.");
    }
    try {
      const out = await markOrderPaid(order, {
        amountKobo: result.amountKobo,
        transactionId: result.transactionId,
        channel: result.channel,
        providerRef: reference,
        by,
      });
      payment.status = "success";
      payment.verifiedAt = new Date();
      payment.providerTransactionId = result.transactionId;
      payment.channel = result.channel;
      payment.gatewayMessage = result.message;
      payment.events.push({ type: "verified", note: `Verified successful via ${by}` });
      await payment.save();
      return { order: out.order, payment, status: "success" };
    } catch (err) {
      payment.status = "failed";
      payment.gatewayMessage = err.message;
      payment.events.push({ type: "mismatch", note: err.message });
      await payment.save();
      throw err;
    }
  }

  const failedStates = ["failed", "abandoned", "reversed", "cancelled"];
  if (failedStates.includes(result.status)) {
    payment.status = result.status === "abandoned" ? "abandoned" : "failed";
    payment.gatewayMessage = result.message;
    payment.events.push({ type: "failed", note: result.message || result.status });
    await payment.save();
    return { order, payment, status: "failed" };
  }
  return { order, payment, status: "pending" };
}
