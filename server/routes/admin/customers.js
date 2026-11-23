import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { z } from "zod";
import { User } from "../../models/User.js";
import { Order } from "../../models/Order.js";
import { requirePermission, requireAdminRole } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler, HttpError, escapeRegex, paginate } from "../../utils/helpers.js";
import { passwordRule } from "../auth.js";
import { publicOrder } from "../../services/orders.js";

const router = Router();
const read = requirePermission("customers:read");
const write = requirePermission("customers");

router.get(
  "/",
  read,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = paginate(req.query, { defaultLimit: 25, maxLimit: 100 });
    const f = { role: "customer" };
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), "i");
      f.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }
    if (req.query.status) f.status = req.query.status;
    const [users, total] = await Promise.all([User.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), User.countDocuments(f)]);
    const ids = users.map((u) => u._id);
    const orders = await Order.find({ user: { $in: ids }, "payment.status": "paid" }, "user total").lean();
    const stats = new Map();
    for (const o of orders) {
      const s = stats.get(String(o.user)) || { orders: 0, spent: 0 };
      s.orders++;
      s.spent += o.total;
      stats.set(String(o.user), s);
    }
    res.json({
      success: true, total, page, pages: Math.ceil(total / limit),
      customers: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, phone: u.phone, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, orders: stats.get(String(u._id))?.orders || 0, spent: stats.get(String(u._id))?.spent || 0 })),
    });
  })
);

/* ---- staff accounts (administrators only). Declared before /:id. ---- */
router.get(
  "/staff/list",
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const staff = await User.find({ role: { $in: ["support", "manager", "admin"] } }).sort({ createdAt: 1 }).lean();
    res.json({ success: true, staff: staff.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, status: u.status, lastLoginAt: u.lastLoginAt })) });
  })
);

router.post(
  "/staff",
  requireAdminRole,
  validate({ body: z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email(), password: passwordRule, role: z.enum(["support", "manager", "admin"]) }) }),
  asyncHandler(async (req, res) => {
    if (await User.exists({ email: req.body.email })) throw new HttpError(409, "An account with this email already exists.");
    const u = await User.create({ name: req.body.name, email: req.body.email, role: req.body.role, passwordHash: await bcrypt.hash(req.body.password, 12) });
    res.status(201).json({ success: true, staff: { id: String(u._id), name: u.name, email: u.email, role: u.role } });
  })
);

router.patch(
  "/staff/:id",
  requireAdminRole,
  validate({ body: z.object({ role: z.enum(["customer", "support", "manager", "admin"]).optional(), status: z.enum(["active", "suspended"]).optional() }) }),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    if (String(req.user._id) === req.params.id) throw new HttpError(400, "You can't change your own role or status.");
    const u = await User.findById(req.params.id);
    if (!u) throw new HttpError(404, "User not found.");
    if (req.body.role) u.role = req.body.role;
    if (req.body.status) u.status = req.body.status;
    u.sessionVersion += 1;
    await u.save();
    res.json({ success: true });
  })
);

router.get(
  "/:id",
  read,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const u = await User.findById(req.params.id).lean();
    if (!u) throw new HttpError(404, "Customer not found.");
    const orders = await Order.find({ $or: [{ user: u._id }, { "customer.email": u.email }] }).sort({ createdAt: -1 }).limit(100);
    res.json({
      success: true,
      customer: { id: String(u._id), name: u.name, email: u.email, phone: u.phone, status: u.status, role: u.role, addresses: u.addresses, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt },
      orders: orders.map((o) => publicOrder(o)),
    });
  })
);

router.patch(
  "/:id",
  write,
  validate({ body: z.object({ status: z.enum(["active", "suspended"]).optional(), name: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(20).optional() }) }),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const u = await User.findOne({ _id: req.params.id, role: "customer" });
    if (!u) throw new HttpError(404, "Customer not found.");
    if (req.body.name) u.name = req.body.name;
    if (req.body.phone !== undefined) u.phone = req.body.phone;
    if (req.body.status) {
      u.status = req.body.status;
      if (req.body.status === "suspended") u.sessionVersion += 1;
    }
    await u.save();
    res.json({ success: true });
  })
);

export default router;
