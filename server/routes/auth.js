import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import { Subscriber } from "../models/Misc.js";
import { issueSession, clearSession, requireAuth } from "../middleware/auth.js";
import { authLimiter, strictLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, HttpError, normalizeNgPhone, randomToken, sha256 } from "../utils/helpers.js";
import { PERMISSIONS, STAFF_ROLES } from "../utils/constants.js";
import { sendPasswordReset, sendWelcome } from "../services/mailer.js";
import { emailVerificationEnabled, issueEmailOtp, verifyEmailOtp, maskEmail, OTP_TTL_MINUTES, RESEND_COOLDOWN_SECONDS } from "../services/emailVerification.js";

const router = Router();

export const passwordRule = z
  .string({ required_error: "Password is required." })
  .min(8, "Password must be at least 8 characters.")
  .max(100, "Password is too long.")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Password must contain at least one letter and one number.");

const email = z.string({ required_error: "Email is required." }).trim().toLowerCase().email("Enter a valid email address.").max(254);
const phoneOptional = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return "";
    const n = normalizeNgPhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a valid Nigerian phone number, e.g. 0803 123 4567." });
      return z.NEVER;
    }
    return n;
  });

const DUMMY_HASH = bcrypt.hashSync("not-a-real-password-1", 10);
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

export function sessionPayload(user) {
  const staff = STAFF_ROLES.includes(user.role);
  return {
    ...user.toSafeJSON(),
    isStaff: staff,
    permissions: staff ? (PERMISSIONS[user.role].includes("*") ? ["*"] : PERMISSIONS[user.role]) : [],
  };
}

const subscribeSignup = (mail) =>
  Subscriber.updateOne({ email: mail }, { $setOnInsert: { email: mail, unsubscribeToken: randomToken(16), source: "signup" }, $set: { active: true } }, { upsert: true });

router.post(
  "/register",
  authLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(2, "Enter your full name.").max(100),
      email,
      phone: phoneOptional,
      password: passwordRule,
      newsletter: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { name, email: mail, phone, password, newsletter } = req.body;
    const verify = emailVerificationEnabled();
    const taken = "An account with this email already exists. Try signing in.";
    const existing = await User.findOne({ email: mail });
    if (existing && existing.emailVerified !== false) throw new HttpError(409, taken);

    const passwordHash = await bcrypt.hash(password, 12);
    let user;
    if (existing) {
      // An earlier signup with this email never finished verifying. That account has never had a session, and only the owner of the
      // inbox can finish verifying it, so this signup takes it over instead of leaving the address blocked forever.
      Object.assign(existing, { name, phone, passwordHash, newsletter: Boolean(newsletter), emailVerified: !verify, sessionVersion: (existing.sessionVersion || 0) + 1 });
      user = await existing.save();
    } else {
      try {
        user = await User.create({ name, email: mail, phone, passwordHash, newsletter: Boolean(newsletter), emailVerified: !verify });
      } catch (e) {
        if (e?.code === 11000) throw new HttpError(409, taken); // two signups for the same email at the same moment
        throw e;
      }
    }

    if (verify) {
      // No session yet: the account is unusable until the emailed code is entered. A failed email never fails signup.
      const otp = await issueEmailOtp(user, { force: !existing });
      return res.status(201).json({
        success: true,
        verificationRequired: true,
        email: mail,
        emailSent: otp.sent,
        reason: otp.sent ? undefined : otp.reason,
        retryAfter: otp.sent ? RESEND_COOLDOWN_SECONDS : otp.retryAfter || 0,
        expiresInMinutes: OTP_TTL_MINUTES,
      });
    }

    if (newsletter) await subscribeSignup(mail);
    issueSession(res, user);
    sendWelcome(user).catch(() => {});
    res.status(201).json({ success: true, user: sessionPayload(user) });
  })
);

router.post(
  "/verify-email",
  authLimiter,
  validate({ body: z.object({ email, code: z.string({ required_error: "Enter the 6-digit code from your email." }).trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email.") }) }),
  asyncHandler(async (req, res) => {
    const user = await verifyEmailOtp(req.body.email, req.body.code);
    if (user.status !== "active") throw new HttpError(403, "This account has been suspended. Please contact support.");
    if (user.newsletter) await subscribeSignup(user.email).catch(() => {}); // only subscribe addresses that proved they own the inbox
    user.lastLoginAt = new Date();
    await user.save();
    issueSession(res, user);
    sendWelcome(user).catch(() => {});
    res.json({ success: true, user: sessionPayload(user) });
  })
);

router.post(
  "/resend-otp",
  authLimiter,
  validate({ body: z.object({ email }) }),
  asyncHandler(async (req, res) => {
    const generic = { success: true, message: "If that email is waiting to be verified, we have sent a new code." };
    if (!emailVerificationEnabled()) return res.json(generic);
    const user = await User.findOne({ email: req.body.email });
    if (!user || user.emailVerified !== false || user.status !== "active") return res.json(generic); // nothing to verify; reveal nothing
    const otp = await issueEmailOtp(user);
    if (otp.reason === "cooldown") {
      throw new HttpError(429, `Please wait ${otp.retryAfter} seconds before asking for another code.`, undefined, { code: "OTP_COOLDOWN", retryAfter: otp.retryAfter });
    }
    if (otp.reason === "limit") {
      throw new HttpError(429, "You have asked for too many codes. Please try again later.", undefined, { code: "OTP_LIMIT", retryAfter: otp.retryAfter });
    }
    if (!otp.sent) {
      throw new HttpError(503, "We couldn't send the email just now. Please try again in a moment.", undefined, { code: "EMAIL_SEND_FAILED", retryAfter: 0 });
    }
    res.json({ ...generic, resendAfter: RESEND_COOLDOWN_SECONDS });
  })
);

router.post(
  "/login",
  authLimiter,
  validate({ body: z.object({ email, password: z.string().min(1, "Enter your password.").max(100) }) }),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select("+passwordHash +failedLogins +lockUntil");
    const generic = new HttpError(401, "Incorrect email or password.");
    if (!user) {
      await bcrypt.compare(req.body.password, DUMMY_HASH);
      throw generic;
    }
    if (user.lockUntil && user.lockUntil > new Date()) {
      throw new HttpError(429, "Too many failed attempts. This account is locked for a few minutes. Try again soon or reset your password.");
    }
    const ok = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!ok) {
      user.failedLogins = (user.failedLogins || 0) + 1;
      if (user.failedLogins >= LOCK_AFTER) {
        user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
        user.failedLogins = 0;
      }
      await user.save();
      throw generic;
    }
    if (user.status !== "active") throw new HttpError(403, "This account has been suspended. Please contact support.");
    if (user.emailVerified === false) {
      if (!emailVerificationEnabled()) {
        user.emailVerified = true; // verification has been switched off: never leave someone stranded behind it
      } else {
        // Right password, email not yet verified: no session. Send a fresh code (cooldown applies) and tell the page to show the code screen.
        user.failedLogins = 0;
        user.lockUntil = undefined;
        await user.save();
        const otp = await issueEmailOtp(user);
        throw new HttpError(403, "Please verify your email to continue.", undefined, {
          code: "EMAIL_NOT_VERIFIED",
          email: user.email,
          emailSent: otp.sent,
          reason: otp.sent ? undefined : otp.reason,
          retryAfter: otp.sent ? RESEND_COOLDOWN_SECONDS : otp.retryAfter || 0,
        });
      }
    }
    user.failedLogins = 0;
    user.lockUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();
    issueSession(res, user);
    res.json({ success: true, user: sessionPayload(user) });
  })
);

router.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ success: true });
});

router.get("/me", requireAuth, (req, res) => res.json({ success: true, user: sessionPayload(req.user) }));

router.post(
  "/forgot-password",
  strictLimiter,
  validate({ body: z.object({ email }) }),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && user.status === "active") {
      const token = randomToken(32);
      user.resetTokenHash = sha256(token);
      user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
      await sendPasswordReset(user, token);
    }
    // Same answer whether or not the account exists, to avoid account enumeration.
    res.json({ success: true, message: "If an account exists for that email, we have sent a reset link." });
  })
);

router.post(
  "/reset-password",
  authLimiter,
  validate({ body: z.object({ token: z.string().min(20).max(200), password: passwordRule }) }),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ resetTokenHash: sha256(req.body.token), resetTokenExpires: { $gt: new Date() } }).select(
      "+resetTokenHash +resetTokenExpires +passwordHash"
    );
    if (!user) throw new HttpError(400, "This reset link is invalid or has expired. Request a new one.");
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.resetTokenHash = undefined;
    user.resetTokenExpires = undefined;
    if (user.emailVerified === false) {
      // The reset link only reaches the owner of the inbox, which is exactly what verification proves.
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
      user.emailOtpHash = undefined;
      user.emailOtpExpires = undefined;
    }
    user.sessionVersion = (user.sessionVersion || 0) + 1; // signs out every other device
    await user.save();
    issueSession(res, user);
    res.json({ success: true, message: "Password updated.", user: sessionPayload(user) });
  })
);

export default router;
