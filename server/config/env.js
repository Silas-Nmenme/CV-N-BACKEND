import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

const num = (v, d) => (v !== "" && v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v, d = false) => (v == null || v === "" ? d : ["1", "true", "yes", "on"].includes(String(v).toLowerCase()));

const jwtSecret = required("JWT_SECRET", isProd ? undefined : "dev-only-secret-change-me-please-0123456789");
if (isProd && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production.");
}

export const env = {
  isProd,
  port: num(process.env.PORT, 5000),
  appUrl: (process.env.APP_URL || `http://localhost:${num(process.env.PORT, 5000)}`).replace(/\/+$/, ""),
  mongoUri: required("MONGO_URI", isProd ? undefined : "mongodb://127.0.0.1:27017/cv_gadgets"),
  jwtSecret,
  jwtExpiresDays: num(process.env.JWT_EXPIRES_DAYS, 14),
  cookieName: process.env.COOKIE_NAME || "cvg_session",
  trustProxy: process.env.TRUST_PROXY ?? (isProd ? "1" : "0"),
  extraOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),

  uploadDir: process.env.UPLOAD_DIR || "uploads",
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  },

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || "CV GADGETS <no-reply@example.com>",
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || "",
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || "",
    baseUrl: (process.env.PAYSTACK_BASE_URL || "https://api.paystack.co").replace(/\/+$/, ""),
  },
  flutterwave: {
    secretKey: process.env.FLW_SECRET_KEY || "",
    publicKey: process.env.FLW_PUBLIC_KEY || "",
    webhookHash: process.env.FLW_SECRET_HASH || "",
    baseUrl: (process.env.FLW_BASE_URL || "https://api.flutterwave.com/v3").replace(/\/+$/, ""),
  },

  adminEmail: (process.env.ADMIN_EMAIL || "").toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminName: process.env.ADMIN_NAME || "Store Administrator",

  pendingOrderMinutes: num(process.env.PENDING_ORDER_MINUTES, 60),
  bankTransferHoldHours: num(process.env.BANK_TRANSFER_HOLD_HOURS, 24),
};

export const paystackEnabled = () => Boolean(env.paystack.secretKey);
export const flutterwaveEnabled = () => Boolean(env.flutterwave.secretKey);
