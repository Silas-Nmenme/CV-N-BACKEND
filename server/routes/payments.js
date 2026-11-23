import { Router } from "express";
import { z } from "zod";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { optionalAuth } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, HttpError } from "../utils/helpers.js";
import { paystack, flutterwave } from "../services/gateways.js";
import { initializePayment, verifyPaymentByReference } from "../services/payments.js";
import { loadOrderForRequest } from "./checkout.js";
import { publicOrder } from "../services/orders.js";

const router = Router();

router.post(
  "/initialize",
  optionalAuth,
  paymentLimiter,
  validate({ body: z.object({ orderReference: z.string().min(6).max(40), accessToken: z.string().max(100).optional(), provider: z.enum(["paystack", "flutterwave"]) }) }),
  asyncHandler(async (req, res) => {
    const order = await loadOrderForRequest(req, req.body.orderReference, req.body.accessToken);
    const { url, reference } = await initializePayment(order, req.body.provider);
    res.json({ success: true, url, reference });
  })
);

/**
 * Called by our "payment result" page after the gateway redirects back.
 * The redirect itself proves nothing: we ask the gateway directly.
 */
router.post(
  "/verify",
  paymentLimiter,
  validate({ body: z.object({ reference: z.string().min(6).max(60).optional(), orderReference: z.string().min(6).max(40).optional() }).refine((b) => b.reference || b.orderReference, "Reference required.") }),
  asyncHandler(async (req, res) => {
    let reference = req.body.reference;
    if (!reference) {
      const latest = await Payment.findOne({ orderReference: req.body.orderReference }).sort({ createdAt: -1 });
      if (!latest) throw new HttpError(404, "No payment found for this order.");
      reference = latest.reference;
    }
    const r = await verifyPaymentByReference(reference, { by: "verify" });
    res.json({ success: true, status: r.status, orderReference: r.order.reference, orderStatus: r.order.status, paymentStatus: r.order.payment.status, message: r.payment.gatewayMessage || "" });
  })
);

/* ------------------------------- webhooks ------------------------------- */
// Mounted at /api/webhooks (raw body captured in server/app.js for signature checks).
export const webhooks = Router();

webhooks.post(
  "/paystack",
  asyncHandler(async (req, res) => {
    if (!paystack.validSignature(req.rawBody, req.get("x-paystack-signature"))) return res.status(401).json({ success: false });
    const event = req.body?.event;
    const reference = req.body?.data?.reference;
    if (event === "charge.success" && reference) {
      if (await Payment.exists({ reference })) {
        await verifyPaymentByReference(reference, { by: "paystack-webhook" });
      } else {
        console.warn("[webhook] Paystack event for unknown reference", reference);
      }
    }
    res.json({ received: true });
  })
);

webhooks.post(
  "/flutterwave",
  asyncHandler(async (req, res) => {
    if (!flutterwave.validWebhook(req.get("verif-hash"))) return res.status(401).json({ success: false });
    const event = req.body?.event;
    const txRef = req.body?.data?.tx_ref || req.body?.txRef;
    if ((event === "charge.completed" || event === "charge.success") && txRef) {
      if (await Payment.exists({ reference: txRef })) {
        await verifyPaymentByReference(txRef, { by: "flutterwave-webhook" });
      } else {
        console.warn("[webhook] Flutterwave event for unknown reference", txRef);
      }
    }
    res.json({ received: true });
  })
);

export default router;
