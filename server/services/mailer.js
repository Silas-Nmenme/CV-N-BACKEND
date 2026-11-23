import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { getSettings } from "../models/Misc.js";
import { formatNaira } from "../utils/helpers.js";

let transporter;
function getTransport() {
  if (!env.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transporter;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const mailLog = []; // last few messages in non-production, handy for tests/dev

function shell(storeName, title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#0e1726">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b1633;color:#fff;padding:18px 24px;font-size:18px;font-weight:700;letter-spacing:.3px">${esc(storeName)}</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f3f5f8;font-size:12px;color:#5b6577">This email was sent by ${esc(storeName)}.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendMail({ to, subject, html, text }) {
  if (!to) return false;
  const transport = getTransport();
  if (!transport) {
    if (!env.isProd) {
      mailLog.push({ to, subject, html, text, at: new Date() });
      if (mailLog.length > 50) mailLog.shift();
      console.log(`[mail:dev] To: ${to} | ${subject}`);
    } else {
      console.warn(`[mail] SMTP not configured; email "${subject}" to ${to} was not sent.`);
    }
    return false;
  }
  try {
    await transport.sendMail({ from: env.smtp.from, to, subject, html, text });
    return true;
  } catch (err) {
    console.error("[mail] send failed:", err.message);
    return false;
  }
}

function itemsTable(order) {
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eef0f4">${esc(i.name)}<br><span style="color:#5b6577;font-size:12px">${esc(Object.values(i.attrs || {}).join(" · "))} × ${i.quantity}</span></td><td align="right" style="padding:6px 0;border-bottom:1px solid #eef0f4">${formatNaira(i.lineTotal)}</td></tr>`
    )
    .join("");
  const line = (label, val, bold) =>
    `<tr><td style="padding:4px 0;${bold ? "font-weight:700" : "color:#5b6577"}">${label}</td><td align="right" style="padding:4px 0;${bold ? "font-weight:700" : ""}">${val}</td></tr>`;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}
${line("Subtotal", formatNaira(order.subtotal))}
${order.discount ? line(`Discount${order.couponCode ? ` (${esc(order.couponCode)})` : ""}`, "-" + formatNaira(order.discount)) : ""}
${line("Delivery", order.shippingFee ? formatNaira(order.shippingFee) : "Free")}
${line("Total", formatNaira(order.total), true)}</table>`;
}

export async function sendOrderConfirmation(order) {
  const s = (await getSettings()).store;
  const trackUrl = `${env.storefrontUrl}/order?ref=${encodeURIComponent(order.reference)}`;
  const html = shell(
    s.name,
    `Thank you, ${order.customer.fullName.split(" ")[0]}! Payment received`,
    `<p>Your order <b>${esc(order.reference)}</b> is confirmed.</p>${itemsTable(order)}
<p style="margin-top:16px">Delivering to: ${esc(order.shipping.address)}, ${esc(order.shipping.city)}, ${esc(order.shipping.state)}</p>
<p><a href="${trackUrl}" style="background:#2145f5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">View your order</a></p>`
  );
  await sendMail({ to: order.customer.email, subject: `Order ${order.reference} confirmed`, html });
  if (s.email) {
    await sendMail({
      to: s.email,
      subject: `New paid order ${order.reference} (${formatNaira(order.total)})`,
      html: shell(s.name, "New paid order", `<p>${esc(order.customer.fullName)} · ${esc(order.customer.phone)}</p>${itemsTable(order)}`),
    });
  }
}

export async function sendOrderPlaced(order) {
  const s = (await getSettings()).store;
  const bank = order.payment.method === "bank_transfer";
  const html = shell(
    s.name,
    `We received your order`,
    `<p>Order <b>${esc(order.reference)}</b> is waiting for payment.${bank ? " Please complete your bank transfer using the order reference as narration." : ""}</p>${itemsTable(order)}`
  );
  await sendMail({ to: order.customer.email, subject: `Order ${order.reference} received`, html });
  if (bank && s.email) {
    await sendMail({
      to: s.email,
      subject: `Bank transfer order ${order.reference} (${formatNaira(order.total)})`,
      html: shell(s.name, "Bank transfer order awaiting payment", `<p>${esc(order.customer.fullName)} · ${esc(order.customer.phone)}</p>${itemsTable(order)}`),
    });
  }
}

export async function sendStatusUpdate(order, note) {
  const s = (await getSettings()).store;
  const labels = { confirmed: "confirmed", processing: "being prepared", dispatched: "on its way", delivered: "delivered", cancelled: "cancelled", refunded: "refunded" };
  const label = labels[order.status];
  if (!label) return;
  const tracking = order.status === "dispatched" && order.dispatch?.trackingNumber
    ? `<p>Courier: ${esc(order.dispatch.courier)} · Tracking: <b>${esc(order.dispatch.trackingNumber)}</b></p>` : "";
  const html = shell(s.name, `Your order is ${label}`, `<p>Order <b>${esc(order.reference)}</b> is now <b>${label}</b>.</p>${note ? `<p>${esc(note)}</p>` : ""}${tracking}
<p><a href="${env.storefrontUrl}/order?ref=${encodeURIComponent(order.reference)}">Track your order</a></p>`);
  await sendMail({ to: order.customer.email, subject: `Order ${order.reference}: ${label}`, html });
}

export async function sendPasswordReset(user, token) {
  const s = (await getSettings()).store;
  const link = `${env.storefrontUrl}/reset-password?token=${token}`;
  const html = shell(s.name, "Reset your password", `<p>We received a request to reset your password. This link works for 1 hour.</p>
<p><a href="${link}" style="background:#2145f5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Choose a new password</a></p>
<p style="color:#5b6577;font-size:13px">If you did not ask for this, you can ignore this email.</p>`);
  const ok = await sendMail({ to: user.email, subject: "Reset your password", html });
  if (!env.isProd && !ok) console.log(`[mail:dev] Password reset link for ${user.email}: ${link}`);
  return link;
}

export async function sendWelcome(user) {
  const s = (await getSettings()).store;
  await sendMail({
    to: user.email,
    subject: `Welcome to ${s.name}`,
    html: shell(s.name, `Welcome, ${user.name.split(" ")[0]}`, `<p>Your account is ready. You can track orders, save a wishlist and check out faster.</p><p><a href="${env.storefrontUrl}/shop">Start shopping</a></p>`),
  });
}

export async function sendContactNotification(enq) {
  const s = (await getSettings()).store;
  if (!s.email) return;
  await sendMail({
    to: s.email,
    subject: `New enquiry: ${enq.subject || "Contact form"}`,
    html: shell(s.name, "New contact enquiry", `<p><b>${esc(enq.name)}</b> (${esc(enq.email)}${enq.phone ? ", " + esc(enq.phone) : ""})</p><p>${esc(enq.message).replace(/\n/g, "<br>")}</p>`),
  });
}
