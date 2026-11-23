import { env } from "../config/env.js";
import { HttpError } from "../utils/helpers.js";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Defence in depth against CSRF on top of SameSite=Lax cookies:
 * a browser always sends Origin on cross-site unsafe requests, so reject any
 * whose Origin is not this site. Server-to-server webhooks send no Origin.
 */
export function originCheck(req, _res, next) {
  if (!UNSAFE.has(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  const clean = origin.replace(/\/+$/, "");
  const host = req.get("host");
  let ok = env.extraOrigins.includes(clean) || clean === env.appUrl;
  try {
    if (!ok && host && new URL(clean).host === host) ok = true;
  } catch {
    ok = false;
  }
  if (!ok) return next(new HttpError(403, "Cross-site request blocked."));
  next();
}

function hasBadKey(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".")) return true;
    if (hasBadKey(value[key], depth + 1)) return true;
  }
  return false;
}

/** Block NoSQL-operator injection ({"$gt": ""}) in body, query and params. */
export function noSqlGuard(req, _res, next) {
  if (hasBadKey(req.body) || hasBadKey(req.query) || hasBadKey(req.params)) {
    return next(new HttpError(400, "Invalid characters in request."));
  }
  next();
}
