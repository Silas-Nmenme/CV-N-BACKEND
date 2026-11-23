import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { HttpError, asyncHandler } from "../utils/helpers.js";
import { PERMISSIONS, STAFF_ROLES } from "../utils/constants.js";

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user._id), sv: user.sessionVersion || 0 }, env.jwtSecret, {
    expiresIn: `${env.jwtExpiresDays}d`,
  });
  res.cookie(env.cookieName, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    maxAge: env.jwtExpiresDays * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(res) {
  res.clearCookie(env.cookieName, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/" });
}

async function loadUser(req) {
  const token = req.cookies?.[env.cookieName];
  if (!token) return null;
  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
  const user = await User.findById(decoded.sub);
  if (!user || user.status !== "active" || (user.sessionVersion || 0) !== (decoded.sv || 0)) return null;
  return user;
}

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = await loadUser(req);
  next();
});

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const user = await loadUser(req);
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  req.user = user;
  next();
});

export function can(user, permission) {
  if (!user || !STAFF_ROLES.includes(user.role)) return false;
  const granted = PERMISSIONS[user.role] || [];
  if (granted.includes("*")) return true;
  if (granted.includes(permission)) return true;
  // "orders" implies "orders:read" and "orders:update"
  const base = permission.split(":")[0];
  return granted.includes(base);
}

/** Require a signed-in staff member holding the given permission. */
export const requirePermission = (permission) =>
  asyncHandler(async (req, _res, next) => {
    const user = await loadUser(req);
    if (!user) throw new HttpError(401, "Please sign in to continue.");
    if (!can(user, permission)) throw new HttpError(403, "You do not have permission to do that.");
    req.user = user;
    next();
  });

export const requireAdminRole = asyncHandler(async (req, _res, next) => {
  const user = await loadUser(req);
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  if (user.role !== "admin") throw new HttpError(403, "Only administrators can do that.");
  req.user = user;
  next();
});
