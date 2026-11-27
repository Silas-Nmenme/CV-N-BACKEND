import crypto from "node:crypto";
import { NG_PHONE_REGEX } from "./constants.js";

export class HttpError extends Error {
  constructor(status, message, details, extra) {
    super(message);
    this.status = status;
    this.details = details;
    this.extra = extra; // merged into the JSON error body, e.g. { code: "EMAIL_NOT_VERIFIED" }
    this.expose = true;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Money helpers: work in kobo internally to avoid floating-point drift. */
export const toKobo = (naira) => Math.round(Number(naira) * 100);
export const fromKobo = (kobo) => Math.round(kobo) / 100;
export const roundNaira = (n) => fromKobo(toKobo(n));

export function normalizeNgPhone(input) {
  const raw = String(input || "").replace(/[\s()-]/g, "");
  if (!NG_PHONE_REGEX.test(raw)) return null;
  const digits = raw.replace(/^\+?234/, "").replace(/^0/, "");
  return `+234${digits}`;
}

export const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function orderReference() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `CVG-${ymd}-${rand}`;
}

export const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

export function paginate(query, { defaultLimit = 24, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export const formatNaira = (n) =>
  "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
