import crypto from "node:crypto";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { HttpError, safeEqual } from "../utils/helpers.js";
import { sendEmailOtp } from "./mailer.js";

/**
 * Email verification at signup: a 6-digit one-time code sent to the address the person typed.
 *
 * Design rules (each one exists so signup cannot get stuck or be abused):
 *  - The code is never stored: only an HMAC (keyed with the server secret) is, so a database leak does not reveal live codes.
 *  - Codes expire after 10 minutes, are single use, and allow 5 wrong guesses before a new code is needed.
 *  - A new code can be requested every 60 seconds, at most 5 times an hour, and a code is only sent once even if two
 *    requests arrive at the same moment (atomic claim).
 *  - Sending mail can never break signup: if the email cannot be sent the account still exists, the person is told, and
 *    they can request a new code straight away (a failed send is not counted against the limits).
 *  - Accounts created before this feature (no `emailVerified` field) and staff-created accounts are treated as verified.
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_WRONG_ATTEMPTS = 5;
export const MAX_SENDS_PER_HOUR = 5;
const HOUR = 60 * 60 * 1000;

const ON = new Set(["on", "true", "1", "yes"]);
const OFF = new Set(["off", "false", "0", "no"]);

/** Whether new signups must verify their email. See `emailVerification` in config/env.js. */
export function emailVerificationEnabled(cfg = env) {
  const mode = String(cfg.emailVerification || "auto").toLowerCase();
  if (ON.has(mode)) return true;
  if (OFF.has(mode)) return false;
  return Boolean(cfg.smtp?.host) || !cfg.isProd; // auto
}

const hashCode = (userId, code) => crypto.createHmac("sha256", env.jwtSecret).update(`${userId}:${code}`).digest("hex");
const newCode = () => String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

export const maskEmail = (e = "") => e.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + "*".repeat(Math.min(b.length, 5)) + c);

/**
 * Create a fresh code for an unverified account and email it. Never throws because of mail problems.
 * Returns { sent: true, retryAfter } or { sent: false, reason: "cooldown" | "limit" | "send_failed" | "missing", retryAfter? }.
 * `force` skips the 60-second cooldown (used for the very first code at signup); the hourly cap still applies.
 */
export async function issueEmailOtp(userOrId, { force = false } = {}) {
  const id = userOrId?._id ?? userOrId;
  const now = new Date();
  const user = await User.findById(id).select("+emailOtpSentAt +emailOtpSendCount +emailOtpWindowStart");
  if (!user || user.emailVerified !== false) return { sent: false, reason: "missing" };

  const windowOpen = user.emailOtpWindowStart && now - user.emailOtpWindowStart < HOUR;
  const sendsThisHour = windowOpen ? user.emailOtpSendCount || 0 : 0;
  if (sendsThisHour >= MAX_SENDS_PER_HOUR) {
    return { sent: false, reason: "limit", retryAfter: Math.max(1, Math.ceil((user.emailOtpWindowStart.getTime() + HOUR - now.getTime()) / 1000)) };
  }
  const cutoff = new Date(now.getTime() - RESEND_COOLDOWN_SECONDS * 1000);
  if (!force && user.emailOtpSentAt && user.emailOtpSentAt > cutoff) {
    return { sent: false, reason: "cooldown", retryAfter: Math.max(1, Math.ceil((user.emailOtpSentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000)) };
  }

  const code = newCode();
  // Claim the send atomically: of two simultaneous requests only one gets to email a code.
  const claimed = await User.findOneAndUpdate(
    {
      _id: user._id,
      emailVerified: false,
      ...(force ? {} : { $or: [{ emailOtpSentAt: { $exists: false } }, { emailOtpSentAt: null }, { emailOtpSentAt: { $lte: cutoff } }] }),
    },
    {
      $set: {
        emailOtpHash: hashCode(user._id, code),
        emailOtpExpires: new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000),
        emailOtpAttempts: 0,
        emailOtpSentAt: now,
        emailOtpWindowStart: windowOpen ? user.emailOtpWindowStart : now,
        emailOtpSendCount: sendsThisHour + 1,
      },
    },
    { new: true }
  );
  if (!claimed) return { sent: false, reason: "cooldown", retryAfter: RESEND_COOLDOWN_SECONDS };

  let delivered = false;
  try {
    const ok = await sendEmailOtp(claimed, code, OTP_TTL_MINUTES);
    delivered = ok || (!env.isProd && !env.smtp.host); // with no SMTP outside production the code is captured in the dev mail log
  } catch (e) {
    console.error("[otp] could not send the verification email:", e.message);
  }
  if (!delivered) {
    // Nothing reached an inbox: allow an immediate retry and don't count this against the hourly limit.
    await User.updateOne({ _id: user._id }, { $unset: { emailOtpSentAt: 1 }, $inc: { emailOtpSendCount: -1 } });
    return { sent: false, reason: "send_failed" };
  }
  return { sent: true, retryAfter: RESEND_COOLDOWN_SECONDS };
}

/** Check a code. On success the account is marked verified (atomically, single use) and the user document is returned. */
export async function verifyEmailOtp(email, code) {
  const user = await User.findOne({ email }).select("+emailOtpHash +emailOtpExpires +emailOtpAttempts");
  if (!user) throw new HttpError(400, "That code isn't right or has expired. Request a new one.", undefined, { code: "OTP_INVALID" });
  if (user.emailVerified !== false) throw new HttpError(409, "This email is already verified. Please sign in.", undefined, { code: "ALREADY_VERIFIED" });
  if (!user.emailOtpHash || !user.emailOtpExpires || user.emailOtpExpires <= new Date()) {
    throw new HttpError(400, "That code has expired. Tap “Resend code” to get a new one.", undefined, { code: "OTP_EXPIRED" });
  }
  if ((user.emailOtpAttempts || 0) >= MAX_WRONG_ATTEMPTS) {
    throw new HttpError(429, "Too many wrong attempts. Tap “Resend code” to get a new one.", undefined, { code: "OTP_LOCKED" });
  }

  if (!safeEqual(hashCode(user._id, code), user.emailOtpHash)) {
    const after = await User.findOneAndUpdate({ _id: user._id }, { $inc: { emailOtpAttempts: 1 } }, { new: true }).select("+emailOtpAttempts");
    const left = Math.max(0, MAX_WRONG_ATTEMPTS - (after?.emailOtpAttempts ?? MAX_WRONG_ATTEMPTS));
    throw new HttpError(
      400,
      left > 0 ? `That code isn't right. ${left} ${left === 1 ? "attempt" : "attempts"} left.` : "That code isn't right. Tap “Resend code” to get a new one.",
      undefined,
      { code: "OTP_INVALID", attemptsLeft: left }
    );
  }

  // Consume the code atomically so it can only ever verify once, even with two simultaneous requests.
  const verified = await User.findOneAndUpdate(
    { _id: user._id, emailVerified: false, emailOtpHash: user.emailOtpHash, emailOtpExpires: { $gt: new Date() } },
    {
      $set: { emailVerified: true, emailVerifiedAt: new Date(), emailOtpAttempts: 0, emailOtpSendCount: 0 },
      $unset: { emailOtpHash: 1, emailOtpExpires: 1, emailOtpSentAt: 1, emailOtpWindowStart: 1 },
    },
    { new: true }
  );
  if (!verified) throw new HttpError(409, "This email is already verified. Please sign in.", undefined, { code: "ALREADY_VERIFIED" });
  return verified;
}
