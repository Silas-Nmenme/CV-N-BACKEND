import rateLimit from "express-rate-limit";

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message },
    skip: () => process.env.DISABLE_RATE_LIMIT === "1",
  });

export const apiLimiter = make(60_000, 300, "Too many requests. Please slow down and try again shortly.");
export const authLimiter = make(15 * 60_000, 20, "Too many attempts. Please wait a few minutes and try again.");
export const strictLimiter = make(60 * 60_000, 10, "Too many requests from this device. Please try again later.");
export const paymentLimiter = make(10 * 60_000, 30, "Too many payment requests. Please wait and try again.");
