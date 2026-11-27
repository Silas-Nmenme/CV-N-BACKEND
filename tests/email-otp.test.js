import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { bootstrap, client, startGatewayStub } from "./helpers.js";

/** Email OTP verification at signup, end to end against the real Express app and MongoDB. */
process.env.EMAIL_VERIFICATION = "on";

let ctx, gw, env, emailVerificationEnabled;
let n = 0;
const fresh = () => ({ name: "Ada Obi", email: `ada${++n}.${Date.now()}@example.com`, password: "Passw0rd99" });
const mails = (to, re) => ctx.mailer.mailLog.filter((m) => m.to === to && re.test(m.subject));
const codeFor = (to) => {
  const m = mails(to, /verification code/).at(-1);
  assert.ok(m, `a verification email was sent to ${to}`);
  const code = m.subject.match(/\b(\d{6})\b/)?.[1];
  assert.ok(code, "the subject carries a 6-digit code");
  assert.ok(m.text.includes(code) && m.html.includes(code), "the code is in the text and html bodies too");
  return code;
};
const dbUser = (email) => ctx.models.User.findOne({ email }).select("+emailOtpHash +emailOtpExpires +emailOtpAttempts +emailOtpSentAt +emailOtpSendCount +emailOtpWindowStart +passwordHash");
const skipCooldown = (email) => ctx.models.User.updateOne({ email }, { emailOtpSentAt: new Date(Date.now() - 61_000) });
const signup = async (over = {}) => {
  const u = { ...fresh(), ...over };
  const c = client(ctx.base);
  const r = await c.post("/api/auth/register", u);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { u, c, r };
};

before(async () => {
  gw = await startGatewayStub();
  ctx = await bootstrap({ dbName: "cvg_test_email_otp", gateway: gw });
  ({ env } = await import("../server/config/env.js"));
  ({ emailVerificationEnabled } = await import("../server/services/emailVerification.js"));
});
after(async () => ctx.close());

test("signup emails a 6-digit code, creates an unverified account and signs nobody in yet", async () => {
  const { u, c, r } = await signup({ newsletter: true });
  assert.equal(r.data.verificationRequired, true);
  assert.equal(r.data.emailSent, true);
  assert.equal(r.data.email, u.email);
  assert.equal(r.data.retryAfter, 60);
  assert.equal(r.data.user, undefined, "no user/session is returned before verification");
  assert.equal((await c.get("/api/auth/me")).status, 401, "no session cookie was issued");

  const code = codeFor(u.email);
  assert.match(code, /^\d{6}$/);
  const db = await dbUser(u.email);
  assert.equal(db.emailVerified, false);
  assert.ok(db.emailOtpHash && !db.emailOtpHash.includes(code) && db.emailOtpHash !== code, "only a keyed hash of the code is stored");
  const mins = (db.emailOtpExpires - Date.now()) / 60000;
  assert.ok(mins > 9 && mins <= 10, `expires in about 10 minutes (${mins.toFixed(1)})`);
  assert.equal(await ctx.models.Misc.Subscriber.countDocuments({ email: u.email }), 0, "newsletter subscription waits until the email is verified");
});

test("the right code verifies, signs the person in, subscribes them, and works exactly once", async () => {
  const { u, c } = await signup({ newsletter: true });
  const code = codeFor(u.email);
  const wrong = code === "000000" ? "111111" : "000000";

  let r = await c.post("/api/auth/verify-email", { email: u.email, code: wrong });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, "OTP_INVALID");
  assert.equal(r.data.attemptsLeft, 4);
  assert.equal((await c.get("/api/auth/me")).status, 401, "a wrong code signs nobody in");

  r = await c.post("/api/auth/verify-email", { email: u.email, code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.email, u.email);
  assert.equal(r.data.user.emailVerified, true);
  assert.equal((await c.get("/api/auth/me")).status, 200, "the session cookie now works");

  const db = await dbUser(u.email);
  assert.equal(db.emailVerified, true);
  assert.ok(db.emailVerifiedAt);
  assert.equal(db.emailOtpHash, undefined, "the used code is gone");
  assert.equal(await ctx.models.Misc.Subscriber.countDocuments({ email: u.email }), 1, "subscribed only after verifying");
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(mails(u.email, /Welcome/).length, 1, "welcome email goes out after verification");

  r = await client(ctx.base).post("/api/auth/verify-email", { email: u.email, code });
  assert.equal(r.status, 409, "a code cannot be used twice");
  assert.equal(r.data.code, "ALREADY_VERIFIED");
});

test("logging in before verifying is refused and points to the code screen; after verifying it works", async () => {
  const { u } = await signup();
  const c = client(ctx.base);
  assert.equal((await c.post("/api/auth/login", { email: u.email, password: "Wr0ngPassword" })).status, 401, "a wrong password still looks like any wrong password");
  const r = await c.post("/api/auth/login", { email: u.email, password: u.password });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, "EMAIL_NOT_VERIFIED");
  assert.equal(r.data.email, u.email);
  assert.equal((await c.get("/api/auth/me")).status, 401, "no session for an unverified account");

  await c.post("/api/auth/verify-email", { email: u.email, code: codeFor(u.email) });
  const ok = await client(ctx.base).post("/api/auth/login", { email: u.email, password: u.password });
  assert.equal(ok.status, 200);
});

test("login for an unverified account sends a fresh code when the last one is old", async () => {
  const { u } = await signup();
  await skipCooldown(u.email);
  const before = mails(u.email, /verification code/).length;
  const r = await client(ctx.base).post("/api/auth/login", { email: u.email, password: u.password });
  assert.equal(r.data.code, "EMAIL_NOT_VERIFIED");
  assert.equal(r.data.emailSent, true);
  assert.equal(mails(u.email, /verification code/).length, before + 1);
});

test("5 wrong guesses lock a code; a new code then works and the old one is dead", async () => {
  const { u, c } = await signup();
  const first = codeFor(u.email);
  const wrong = first === "123456" ? "654321" : "123456";
  for (let i = 4; i >= 0; i--) {
    const r = await c.post("/api/auth/verify-email", { email: u.email, code: wrong });
    assert.equal(r.status, 400);
    assert.equal(r.data.attemptsLeft, i);
  }
  let r = await c.post("/api/auth/verify-email", { email: u.email, code: first });
  assert.equal(r.status, 429, "even the right code is refused once locked");
  assert.equal(r.data.code, "OTP_LOCKED");

  await skipCooldown(u.email);
  assert.equal((await c.post("/api/auth/resend-otp", { email: u.email })).status, 200);
  const second = codeFor(u.email);
  assert.notEqual(second, first);
  r = await c.post("/api/auth/verify-email", { email: u.email, code: first });
  if (first !== second) assert.equal(r.status, 400, "the old code no longer works");
  r = await c.post("/api/auth/verify-email", { email: u.email, code: second });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("an expired code says so, and a new code fixes it", async () => {
  const { u, c } = await signup();
  const code = codeFor(u.email);
  await ctx.models.User.updateOne({ email: u.email }, { emailOtpExpires: new Date(Date.now() - 1000) });
  let r = await c.post("/api/auth/verify-email", { email: u.email, code });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, "OTP_EXPIRED");
  await skipCooldown(u.email);
  assert.equal((await c.post("/api/auth/resend-otp", { email: u.email })).status, 200);
  r = await c.post("/api/auth/verify-email", { email: u.email, code: codeFor(u.email) });
  assert.equal(r.status, 200);
});

test("resend: 60s cooldown, 5 per hour, and two simultaneous requests send only one email", async () => {
  const { u, c } = await signup();
  const sent = () => mails(u.email, /verification code/).length;
  assert.equal(sent(), 1);

  let r = await c.post("/api/auth/resend-otp", { email: u.email });
  assert.equal(r.status, 429);
  assert.equal(r.data.code, "OTP_COOLDOWN");
  assert.ok(r.data.retryAfter > 0 && r.data.retryAfter <= 60);
  assert.equal(sent(), 1, "the cooldown sent nothing");

  await skipCooldown(u.email);
  const both = await Promise.all([c.post("/api/auth/resend-otp", { email: u.email }), c.post("/api/auth/resend-otp", { email: u.email })]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 429], "a double click is harmless");
  assert.equal(sent(), 2, "exactly one new email");

  for (let i = 0; i < 3; i++) { await skipCooldown(u.email); assert.equal((await c.post("/api/auth/resend-otp", { email: u.email })).status, 200); }
  assert.equal(sent(), 5);
  await skipCooldown(u.email);
  r = await c.post("/api/auth/resend-otp", { email: u.email });
  assert.equal(r.status, 429);
  assert.equal(r.data.code, "OTP_LIMIT", "5 codes an hour is the cap");
  assert.equal(sent(), 5);
});

test("an unfinished signup can be redone with the same email; a verified email cannot be re-registered", async () => {
  const a = fresh();
  const c1 = client(ctx.base);
  await c1.post("/api/auth/register", { ...a, name: "First Try" });
  await skipCooldown(a.email);
  const c2 = client(ctx.base);
  const r = await c2.post("/api/auth/register", { ...a, name: "Second Try", password: "NewPassw0rd1" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.verificationRequired, true);
  assert.equal(r.data.emailSent, true, "a fresh code was sent");
  assert.equal(await ctx.models.User.countDocuments({ email: a.email }), 1, "the same account was reused, not duplicated");
  assert.equal((await dbUser(a.email)).name, "Second Try");

  assert.equal((await c2.post("/api/auth/verify-email", { email: a.email, code: codeFor(a.email) })).status, 200);
  assert.equal((await client(ctx.base).post("/api/auth/login", { email: a.email, password: "NewPassw0rd1" })).status, 200);
  assert.equal((await client(ctx.base).post("/api/auth/login", { email: a.email, password: a.password })).status, 401, "the earlier attempt's password is gone");
  assert.equal((await client(ctx.base).post("/api/auth/register", a)).status, 409, "now verified: cannot register again");
});

test("registering again right away does not spam the inbox", async () => {
  const a = fresh();
  await client(ctx.base).post("/api/auth/register", a);
  const r = await client(ctx.base).post("/api/auth/register", a);
  assert.equal(r.status, 201);
  assert.equal(r.data.emailSent, false);
  assert.equal(r.data.reason, "cooldown");
  assert.ok(r.data.retryAfter > 0);
  assert.equal(mails(a.email, /verification code/).length, 1);
});

test("unknown emails reveal nothing and send nothing", async () => {
  const c = client(ctx.base);
  const before = ctx.mailer.mailLog.length;
  let r = await c.post("/api/auth/verify-email", { email: "nobody@example.com", code: "123456" });
  assert.equal(r.status, 400);
  r = await c.post("/api/auth/resend-otp", { email: "nobody@example.com" });
  assert.equal(r.status, 200);
  assert.match(r.data.message, /If that email/);
  assert.equal(ctx.mailer.mailLog.length, before);
});

test("the code must be exactly 6 digits", async () => {
  const c = client(ctx.base);
  for (const code of ["abc123", "12345", "1234567", "12 345", ""]) {
    assert.equal((await c.post("/api/auth/verify-email", { email: "x@example.com", code })).status, 400, `rejects '${code}'`);
  }
});

test("accounts that existed before this feature (no emailVerified field) and staff accounts still sign in", async () => {
  const email = `legacy${Date.now()}@example.com`;
  await ctx.models.User.collection.insertOne({ name: "Old Customer", email, passwordHash: await bcrypt.hash("Passw0rd99", 10), role: "customer", status: "active", addresses: [], wishlist: [], cart: [], sessionVersion: 0, createdAt: new Date(), updatedAt: new Date() });
  const c = client(ctx.base);
  const r = await c.post("/api/auth/login", { email, password: "Passw0rd99" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.emailVerified, true);
  assert.equal((await c.get("/api/auth/me")).status, 200);
  assert.equal((await client(ctx.base).post("/api/auth/login", { email: "owner@test.ng", password: "Owner12345" })).status, 200, "the seeded owner account is unaffected");
});

test("resetting the password on an unverified account verifies it (the link proves inbox ownership)", async () => {
  const { u } = await signup();
  const c = client(ctx.base);
  await c.post("/api/auth/forgot-password", { email: u.email });
  const link = mails(u.email, /Reset/).at(-1).html.match(/reset-password\?token=([a-f0-9]+)/)[1];
  const r = await c.post("/api/auth/reset-password", { token: link, password: "Another1Pass" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await c.get("/api/auth/me")).status, 200);
  assert.equal((await dbUser(u.email)).emailVerified, true);
});

test("simultaneous submissions of the right code: one succeeds, the rest are told it is already verified", async () => {
  const { u } = await signup();
  const code = codeFor(u.email);
  const rs = await Promise.all([1, 2, 3].map(() => client(ctx.base).post("/api/auth/verify-email", { email: u.email, code })));
  assert.deepEqual(rs.map((x) => x.status).sort(), [200, 409, 409]);
});

test("a session cookie for an unverified account is never accepted", async () => {
  const { u } = await signup();
  const id = String((await dbUser(u.email))._id);
  const token = jwt.sign({ sub: id, sv: 0 }, "test-secret-0123456789-0123456789-abcdef");
  const r = await fetch(`${ctx.base}/api/auth/me`, { headers: { Cookie: `cvg_session=${token}` } });
  assert.equal(r.status, 401);
});

test("verification can be switched off: signup is instant again, and stranded accounts can sign in", async () => {
  const pending = await signup(); // unverified while verification was on
  env.emailVerification = "off";
  try {
    const c = client(ctx.base);
    const u = fresh();
    const r = await c.post("/api/auth/register", u);
    assert.equal(r.status, 201);
    assert.equal(r.data.verificationRequired, undefined);
    assert.equal(r.data.user.emailVerified, true);
    assert.equal((await c.get("/api/auth/me")).status, 200, "signed in immediately");

    const login = await client(ctx.base).post("/api/auth/login", { email: pending.u.email, password: pending.u.password });
    assert.equal(login.status, 200, "an account stranded mid-verification is let in when verification is off");
  } finally {
    env.emailVerification = "on";
  }
});

test("'auto' mode only requires verification where email can actually be sent", () => {
  const smtp = (host) => ({ host });
  assert.equal(emailVerificationEnabled({ emailVerification: "auto", isProd: true, smtp: smtp("") }), false, "production without SMTP: signup must keep working");
  assert.equal(emailVerificationEnabled({ emailVerification: "auto", isProd: true, smtp: smtp("smtp.example.com") }), true);
  assert.equal(emailVerificationEnabled({ emailVerification: "auto", isProd: false, smtp: smtp("") }), true, "dev: codes are printed to the console");
  assert.equal(emailVerificationEnabled({ emailVerification: undefined, isProd: true, smtp: smtp("") }), false, "default is auto");
  assert.equal(emailVerificationEnabled({ emailVerification: "on", isProd: true, smtp: smtp("") }), true);
  assert.equal(emailVerificationEnabled({ emailVerification: "off", isProd: false, smtp: smtp("x") }), false);
  assert.equal(emailVerificationEnabled({ emailVerification: "TRUE", isProd: true, smtp: smtp("") }), true);
});
