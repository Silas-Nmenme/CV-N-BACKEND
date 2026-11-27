import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { bootstrap, client, startGatewayStub } from "./helpers.js";

/** The mail server accepts the connection and then never answers. Signup must come back quickly instead of hanging until the host kills it. */
process.env.EMAIL_VERIFICATION = "on";
let ctx, gw, env, hang;

before(async () => {
  gw = await startGatewayStub();
  hang = net.createServer(() => {}); // accepts connections, says nothing, ever
  await new Promise((r) => hang.listen(0, "127.0.0.1", r));
  ctx = await bootstrap({ dbName: "cvg_test_email_otp_hang", gateway: gw });
  ({ env } = await import("../server/config/env.js"));
  Object.assign(env.smtp, { host: "127.0.0.1", port: hang.address().port, secure: false, user: "", pass: "" });
  env.mailTimeoutMs = 700;
});
after(async () => { hang.closeAllConnections?.(); hang.close(); await ctx.close(); });

test("a mail server that hangs is cut off after the timeout: signup returns fast with emailSent:false", async () => {
  const t0 = Date.now();
  const r = await client(ctx.base).post("/api/auth/register", { name: "Ada Obi", email: "ada.hang@example.com", password: "Passw0rd99" });
  const ms = Date.now() - t0;
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.verificationRequired, true);
  assert.equal(r.data.emailSent, false);
  assert.equal(r.data.reason, "send_failed");
  assert.ok(ms < 3500, `answered in ${ms}ms (cap is 700ms plus overhead), not minutes`);
});

test("resend against a hanging mail server also returns promptly with 503", async () => {
  const t0 = Date.now();
  const r = await client(ctx.base).post("/api/auth/resend-otp", { email: "ada.hang@example.com" });
  assert.equal(r.status, 503);
  assert.ok(Date.now() - t0 < 3500);
});
