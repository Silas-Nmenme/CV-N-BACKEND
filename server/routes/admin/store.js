import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { ShippingZone } from "../../models/ShippingZone.js";
import { Page, Enquiry, Subscriber, Setting, getSettings } from "../../models/Misc.js";
import { requirePermission, requireAdminRole } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { crudRouter } from "../../utils/crud.js";
import { asyncHandler, HttpError, paginate, escapeRegex, slugify } from "../../utils/helpers.js";
import { NIGERIAN_STATES } from "../../utils/constants.js";
import { env, paystackEnabled, flutterwaveEnabled } from "../../config/env.js";

const method = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]+$/, "Method codes use lowercase letters, numbers, - or _."),
  name: z.string().trim().min(1).max(60),
  fee: z.number().min(0).max(10_000_000),
  freeOver: z.number().min(0).nullable().optional(),
  etaMinDays: z.number().int().min(0).nullable().optional(),
  etaMaxDays: z.number().int().min(0).nullable().optional(),
});

export const zones = crudRouter(ShippingZone, {
  permission: "delivery",
  sort: { sortOrder: 1, name: 1 },
  search: ["name"],
  schema: z.object({
    name: z.string().trim().min(2, "Name the zone (e.g. Lagos Mainland).").max(80),
    states: z.array(z.enum(NIGERIAN_STATES)).min(1, "Select at least one state."),
    methods: z.array(method).min(1, "Add at least one delivery method.").max(6),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  }),
  async beforeSave(doc) {
    if (!doc.active) return;
    const clash = await ShippingZone.findOne({ _id: { $ne: doc._id }, active: true, states: { $in: doc.states } }).lean();
    if (clash) {
      const overlap = doc.states.filter((s) => clash.states.includes(s));
      throw new HttpError(409, `${overlap.join(", ")} already belong to the zone "${clash.name}". A state can only be in one active zone.`);
    }
  },
});

/* ------------------------------- settings ------------------------------- */
export const settings = Router();
const settingsGuard = requirePermission("content");

const url = z.string().trim().max(300).refine((v) => v === "" || /^https?:\/\//.test(v), "Use a full link starting with https://").default("");
const settingsSchema = z.object({
  store: z.object({
    name: z.string().trim().min(2).max(60),
    tagline: z.string().trim().max(140).default(""),
    email: z.string().trim().toLowerCase().email().or(z.literal("")).default(""),
    phone: z.string().trim().max(30).default(""),
    whatsapp: z.string().trim().max(20).default("").transform((v) => {
      const d = v.replace(/\D/g, "");
      return d.startsWith("0") ? `234${d.slice(1)}` : d;
    }),
    address: z.string().trim().max(300).default(""),
    openingHours: z.string().trim().max(200).default(""),
    mapUrl: url,
    social: z.object({ instagram: url, facebook: url, tiktok: url, x: url, youtube: url }).default({}),
    announcement: z.string().trim().max(200).default(""),
  }),
  payments: z.object({
    paystack: z.boolean(),
    flutterwave: z.boolean(),
    bankTransfer: z.boolean(),
    bankName: z.string().trim().max(80).default(""),
    accountName: z.string().trim().max(120).default(""),
    accountNumber: z.string().trim().max(20).regex(/^\d*$/, "Account numbers contain digits only.").default(""),
    transferInstructions: z.string().trim().max(500).default(""),
  }),
  delivery: z.object({ pickupEnabled: z.boolean(), pickupNote: z.string().trim().max(200).default("") }),
  shop: z.object({ lowStockThreshold: z.number().int().min(0).max(1000), returnsWindowDays: z.number().int().min(0).max(90), freeShippingNote: z.string().trim().max(160).default("") }),
  trust: z.array(z.object({ title: z.string().trim().min(1).max(60), text: z.string().trim().max(160).default("") })).max(6),
});

settings.get(
  "/",
  settingsGuard,
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    res.json({
      success: true,
      settings: s,
      credentials: { paystack: paystackEnabled(), flutterwave: flutterwaveEnabled(), flutterwaveWebhook: Boolean(env.flutterwave.webhookHash), smtp: Boolean(env.smtp.host), cloudinary: Boolean(env.cloudinary.cloudName) },
      webhookUrls: { paystack: `${env.appUrl}/api/webhooks/paystack`, flutterwave: `${env.appUrl}/api/webhooks/flutterwave` },
    });
  })
);

settings.put(
  "/",
  settingsGuard,
  validate({ body: settingsSchema }),
  asyncHandler(async (req, res) => {
    const p = req.body.payments;
    if (p.bankTransfer && (!p.bankName || !p.accountName || !p.accountNumber)) throw new HttpError(400, "Add the bank name, account name and account number to offer bank transfer.");
    const s = await getSettings();
    s.set(req.body);
    await s.save();
    res.json({ success: true, settings: s });
  })
);

/* -------------------------------- pages --------------------------------- */
export const pages = Router();
const pagesGuard = requirePermission("content");

pages.get("/", pagesGuard, asyncHandler(async (req, res) => res.json({ success: true, items: await Page.find({}, "slug title updatedAt").sort({ slug: 1 }).lean() })));
pages.get(
  "/:slug",
  pagesGuard,
  asyncHandler(async (req, res) => {
    const p = await Page.findOne({ slug: req.params.slug }).lean();
    if (!p) throw new HttpError(404, "Page not found.");
    res.json({ success: true, item: p });
  })
);
pages.put(
  "/:slug",
  pagesGuard,
  validate({ body: z.object({ title: z.string().trim().min(2).max(120), body: z.string().max(40000) }) }),
  asyncHandler(async (req, res) => {
    const slug = slugify(req.params.slug);
    const p = await Page.findOneAndUpdate({ slug }, { $set: { title: req.body.title, body: req.body.body, updatedBy: req.user.email } }, { new: true, upsert: true });
    res.json({ success: true, item: p });
  })
);

/* ------------------------------ enquiries ------------------------------- */
export const enquiries = Router();
const enqGuard = requirePermission("enquiries");

enquiries.get(
  "/",
  enqGuard,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = paginate(req.query, { defaultLimit: 25 });
    const f = {};
    if (["new", "in_progress", "resolved"].includes(req.query.status)) f.status = req.query.status;
    const [items, total] = await Promise.all([Enquiry.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Enquiry.countDocuments(f)]);
    res.json({ success: true, items, total, page, pages: Math.ceil(total / limit) });
  })
);
enquiries.patch(
  "/:id",
  enqGuard,
  validate({ body: z.object({ status: z.enum(["new", "in_progress", "resolved"]).optional(), adminNote: z.string().trim().max(1000).optional() }) }),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const e = await Enquiry.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!e) throw new HttpError(404, "Enquiry not found.");
    res.json({ success: true, item: e });
  })
);
enquiries.delete(
  "/:id",
  enqGuard,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    await Enquiry.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  })
);

/* ----------------------------- subscribers ------------------------------ */
export const subscribers = Router();
const subGuard = requirePermission("subscribers");

subscribers.get(
  "/",
  subGuard,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = paginate(req.query, { defaultLimit: 50, maxLimit: 200 });
    const f = {};
    if (req.query.q) f.email = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), "i");
    if (req.query.active) f.active = req.query.active === "true";
    const [items, total] = await Promise.all([Subscriber.find(f, "email active source createdAt").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Subscriber.countDocuments(f)]);
    res.json({ success: true, items, total, page, pages: Math.ceil(total / limit) });
  })
);
subscribers.get(
  "/export.csv",
  subGuard,
  asyncHandler(async (req, res) => {
    const all = await Subscriber.find({ active: true }, "email createdAt").sort({ createdAt: -1 }).lean();
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="subscribers.csv"' });
    res.send("email,subscribed_at\r\n" + all.map((s) => `${s.email},${s.createdAt.toISOString()}`).join("\r\n"));
  })
);
subscribers.delete(
  "/:id",
  subGuard,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    await Subscriber.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  })
);

export { requireAdminRole, Setting };
