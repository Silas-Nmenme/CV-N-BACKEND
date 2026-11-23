import crypto from "node:crypto";
import { env } from "../config/env.js";
import { HttpError, safeEqual, toKobo } from "../utils/helpers.js";

async function call(url, { method = "GET", headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    throw new HttpError(502, "The payment provider could not be reached. Please try again.");
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- PAYSTACK -------------------------------- */
export const paystack = {
  async initialize({ email, amount, reference, callbackUrl, metadata }) {
    const r = await call(`${env.paystack.baseUrl}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.paystack.secretKey}` },
      body: { email, amount: toKobo(amount), currency: "NGN", reference, callback_url: callbackUrl, metadata },
    });
    if (!r.ok || !r.json?.status || !r.json?.data?.authorization_url) {
      throw new HttpError(502, r.json?.message || "Paystack could not start the payment.");
    }
    return { url: r.json.data.authorization_url, accessCode: r.json.data.access_code };
  },

  /** Always ask Paystack directly; never trust browser redirects or webhook bodies alone. */
  async verify(reference) {
    const r = await call(`${env.paystack.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.paystack.secretKey}` },
    });
    if (r.status === 404) return { found: false };
    if (!r.ok || !r.json?.status) throw new HttpError(502, r.json?.message || "Could not verify the payment with Paystack.");
    const d = r.json.data || {};
    return {
      found: true,
      success: d.status === "success",
      status: d.status,
      reference: d.reference,
      amountKobo: Number(d.amount),
      currency: d.currency,
      transactionId: String(d.id ?? ""),
      channel: d.channel || "",
      message: d.gateway_response || "",
    };
  },

  validSignature(rawBody, signature) {
    if (!rawBody || !signature || !env.paystack.secretKey) return false;
    const expected = crypto.createHmac("sha512", env.paystack.secretKey).update(rawBody).digest("hex");
    return safeEqual(expected, String(signature));
  },
};

/* ------------------------------ FLUTTERWAVE ------------------------------ */
export const flutterwave = {
  async initialize({ email, name, phone, amount, reference, redirectUrl, title }) {
    const r = await call(`${env.flutterwave.baseUrl}/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.flutterwave.secretKey}` },
      body: {
        tx_ref: reference,
        amount,
        currency: "NGN",
        redirect_url: redirectUrl,
        customer: { email, name, phonenumber: phone },
        customizations: { title, description: `Order ${reference.split("-P")[0]}` },
      },
    });
    if (!r.ok || r.json?.status !== "success" || !r.json?.data?.link) {
      throw new HttpError(502, r.json?.message || "Flutterwave could not start the payment.");
    }
    return { url: r.json.data.link };
  },

  async verify(reference) {
    const r = await call(`${env.flutterwave.baseUrl}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.flutterwave.secretKey}` },
    });
    if (r.status === 404 || r.json?.message?.toLowerCase?.().includes("no transaction")) return { found: false };
    if (!r.ok || r.json?.status !== "success") throw new HttpError(502, r.json?.message || "Could not verify the payment with Flutterwave.");
    const d = r.json.data || {};
    return {
      found: true,
      success: d.status === "successful",
      status: d.status,
      reference: d.tx_ref,
      amountKobo: toKobo(d.amount),
      currency: d.currency,
      transactionId: String(d.id ?? ""),
      channel: d.payment_type || "",
      message: d.processor_response || "",
    };
  },

  validWebhook(headerValue) {
    if (!env.flutterwave.webhookHash || !headerValue) return false;
    return safeEqual(env.flutterwave.webhookHash, String(headerValue));
  },
};
