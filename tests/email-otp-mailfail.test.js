import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootstrap, client, startGatewayStub } from "./helpers.js";

/** The mail server is down (connection refused). Signup must still work: the account exists, the person is told, and retrying is immediate. */
process.env.EMAIL_VERIFICATION = "on";
let ctx, gw, env;
const u = { name: "Ada Obi", email: "ada.mailfail@example.com", password: "Passw0rd99" };

before(async () => {
  gw = await startGatewayStub();
  ctx = await bootstrap({ dbName: "cvg_test_email_otp_fail", gateway: gw });
  ({ env } = await import("../server/config/env.js"));
  Object.assign(env.smtp, { host: "127.0.0.1", port: 9, secure: false, user: "", pass: "" }); // nothing listens on port 9
});
after(async () => ctx.close());

test("when the email cannot be sent, signup still succeeds and says so (never a 500)", async () => {
  const c = client(ctx.base);
  const r = await c.post("/api/auth/register", u);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.verificationRequired, true);
  assert.equal(r.data.emailSent, false);
  assert.equal(r.data.reason, "send_failed");
  assert.equal(r.data.retryAfter, 0, "no waiting: they can retry straight away");
  const db = await ctx.models.User.findOne({ email: u.email }).select("+emailOtpSentAt +emailOtpSendCount");
  assert.ok(db, "the account was created");
  assert.equal(db.emailVerified, false);
  assert.equal(db.emailOtpSentAt, undefined, "a failed send does not start the cooldown");
  assert.equal(db.emailOtpSendCount, 0, "…and does not count against the hourly limit");
});

test("resend while the mail server is still down answers 503 with a clear message, not 429 or 500", async () => {
  const r = await client(ctx.base).post("/api/auth/resend-otp", { email: u.email });
  assert.equal(r.status, 503);
  assert.equal(r.data.code, "EMAIL_SEND_FAILED");
  assert.match(r.data.message, /couldn't send/i);
  const again = await client(ctx.base).post("/api/auth/resend-otp", { email: u.email });
  assert.equal(again.status, 503, "still immediate, never locked out by the cooldown");
});

test("logging in while the mail server is down reports the unverified state and the send problem", async () => {
  const r = await client(ctx.base).post("/api/auth/login", { email: u.email, password: u.password });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, "EMAIL_NOT_VERIFIED");
  assert.equal(r.data.emailSent, false);
});

test("once mail works again, 'Resend code' succeeds immediately and the code verifies the account", async () => {
  env.smtp.host = ""; // mail recovered (outside production this is captured in the dev mail log)
  const c = client(ctx.base);
  const r = await c.post("/api/auth/resend-otp", { email: u.email });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const code = ctx.mailer.mailLog.filter((m) => m.to === u.email && /verification code/.test(m.subject)).at(-1).subject.match(/\b(\d{6})\b/)[1];
  const v = await c.post("/api/auth/verify-email", { email: u.email, code });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal((await c.get("/api/auth/me")).status, 200);
});
