import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Starts a fake Paystack + Flutterwave API so payment flows can be tested without real credentials. */
export async function startGatewayStub() {
  const state = { paystack: new Map(), flw: new Map(), calls: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (obj, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      const data = body ? JSON.parse(body) : {};
      state.calls.push(`${req.method} ${req.url}`);
      const url = new URL(req.url, "http://x");
      const self = `http://${req.headers.host}`;
      if (url.pathname.startsWith("/pay/") || url.pathname.startsWith("/complete/") || url.pathname.startsWith("/cancel/")) {
        // Minimal stand-in for the gateway's hosted payment page (used by the browser end-to-end test).
        const ref = decodeURIComponent(url.pathname.split("/").pop());
        const t = state.paystack.get(ref) || state.flw.get(ref);
        if (!t) { res.writeHead(404); return res.end("unknown reference"); }
        if (url.pathname.startsWith("/pay/")) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<html><body><h1 id="gw">Stub gateway</h1><p id="amt">${t.amount}</p><a id="complete" href="/complete/${ref}">Pay now</a> <a id="cancel" href="/cancel/${ref}">Cancel</a></body></html>`); }
        const ok = url.pathname.startsWith("/complete/");
        t.status = state.paystack.has(ref) ? (ok ? "success" : "abandoned") : (ok ? "successful" : "cancelled");
        res.writeHead(302, { Location: t.callback + (t.callback.includes("?") ? "&" : "?") + (state.paystack.has(ref) ? `reference=${ref}` : `status=${ok ? "successful" : "cancelled"}&tx_ref=${ref}`) });
        return res.end();
      }
      if (req.url === "/transaction/initialize") {
        state.paystack.set(data.reference, { amount: data.amount, currency: data.currency, status: "pending", email: data.email, callback: data.callback_url });
        return json({ status: true, data: { authorization_url: `${self}/pay/${data.reference}`, access_code: "ac_1", reference: data.reference } });
      }
      if (url.pathname.startsWith("/transaction/verify/")) {
        const ref = decodeURIComponent(url.pathname.split("/").pop());
        const t = state.paystack.get(ref);
        if (!t) return json({ status: false, message: "Transaction reference not found" }, 404);
        return json({ status: true, data: { id: 9001, status: t.status, reference: ref, amount: t.overrideAmount ?? t.amount, currency: t.currency, channel: "card", gateway_response: t.status === "success" ? "Successful" : "Declined" } });
      }
      if (url.pathname === "/payments") {
        state.flw.set(data.tx_ref, { amount: data.amount, currency: data.currency, status: "pending", callback: data.redirect_url });
        return json({ status: "success", data: { link: `${self}/pay/${data.tx_ref}` } });
      }
      if (url.pathname === "/transactions/verify_by_reference") {
        const ref = url.searchParams.get("tx_ref");
        const t = state.flw.get(ref);
        if (!t) return json({ status: "error", message: "No transaction was found for this id" }, 404);
        return json({ status: "success", data: { id: 777, tx_ref: ref, status: t.status, amount: t.overrideAmount ?? t.amount, currency: t.currency, payment_type: "card", processor_response: "ok" } });
      }
      json({ message: "not found" }, 404);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

export async function bootstrap({ dbName, gateway } = {}) {
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "cvg-up-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGO_URI: `mongodb://127.0.0.1:27017/${dbName}`,
    JWT_SECRET: "test-secret-0123456789-0123456789-abcdef",
    DISABLE_RATE_LIMIT: "1",
    UPLOAD_DIR: uploads,
    PAYSTACK_SECRET_KEY: "sk_test_secret",
    PAYSTACK_BASE_URL: gateway.url,
    FLW_SECRET_KEY: "FLWSECK_TEST",
    FLW_SECRET_HASH: "flw-hash-123",
    FLW_BASE_URL: gateway.url,
    APP_URL: "https://cvgadgets.vercel.app",
    STOREFRONT_URL: "https://cvgadgets.vercel.app",
    ALLOWED_ORIGINS: "https://store.example.test,https://cvgadgets.vercel.app",
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    CLOUDINARY_CLOUD_NAME: "",
    CLOUDINARY_API_KEY: "",
    CLOUDINARY_API_SECRET: "",
    ADMIN_EMAIL: "",
    ADMIN_PASSWORD: "",
  });
  const mongoose = (await import("mongoose")).default;
  const { connectDB } = await import("../server/config/db.js");
  await connectDB();
  await mongoose.connection.dropDatabase();
  const { ensureIndexes } = await import("../server/scripts/indexes.js");
  await ensureIndexes();
  const { seedBase, seedAdmin } = await import("../server/scripts/baseData.js");
  await seedBase();
  const { ShippingZone } = await import("../server/models/ShippingZone.js");
  const zoneFees = [3500, 5500, 6500, 7000, 9000];
  for (const zone of await ShippingZone.find().sort({ sortOrder: 1 })) {
    zone.active = true;
    zone.methods[0].fee = zoneFees[zone.sortOrder] ?? 0;
    await zone.save();
  }
  const { seedTestCatalog } = await import("./fixtures/catalogData.js");
  await seedTestCatalog();
  await seedAdmin("owner@test.ng", "Owner12345", "Owner");
  const { createApp } = await import("../server/app.js");
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const models = {
    Product: (await import("../server/models/Product.js")).Product,
    Order: (await import("../server/models/Order.js")).Order,
    User: (await import("../server/models/User.js")).User,
    Coupon: (await import("../server/models/Coupon.js")).Coupon,
    Payment: (await import("../server/models/Payment.js")).Payment,
    Misc: await import("../server/models/Misc.js"),
  };
  const orders = await import("../server/services/orders.js");
  const mailer = await import("../server/services/mailer.js");
  return {
    base, models, orders, mailer, mongoose,
    async close() { await new Promise((r) => server.close(r)); await mongoose.disconnect(); await gateway.close(); },
  };
}

/** Tiny HTTP client with a cookie jar. */
export function client(base) {
  let cookie = "";
  async function call(method, url, body, { headers = {}, raw } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body && !raw ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
      redirect: "manual",
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [pair] = c.split(";");
      const [name, val] = pair.split("=");
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c) || val === "") cookie = cookie.split("; ").filter((x) => !x.startsWith(name + "=")).join("; ");
      else cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(name + "=")), pair].join("; ");
    }
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (u, o) => call("GET", u, null, o),
    post: (u, b, o) => call("POST", u, b ?? {}, o),
    put: (u, b, o) => call("PUT", u, b ?? {}, o),
    patch: (u, b, o) => call("PATCH", u, b ?? {}, o),
    del: (u, o) => call("DELETE", u, null, o),
    rawPost: (u, raw, headers) => call("POST", u, null, { raw, headers }),
    clearCookies: () => (cookie = ""),
  };
}

export const paystackSig = (raw) => crypto.createHmac("sha512", "sk_test_secret").update(raw).digest("hex");
