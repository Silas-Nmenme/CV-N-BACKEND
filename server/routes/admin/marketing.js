import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Coupon } from "../../models/Coupon.js";
import { Review } from "../../models/Review.js";
import { Banner, Testimonial } from "../../models/Misc.js";
import { requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { crudRouter } from "../../utils/crud.js";
import { asyncHandler, HttpError, paginate } from "../../utils/helpers.js";
import { recomputeRating } from "../../services/reviews.js";

const date = z.preprocess((v) => (v === "" || v == null ? null : new Date(v)), z.date().nullable());
const objectId = z.string().length(24);

export const coupons = crudRouter(Coupon, {
  permission: "coupons",
  search: ["code", "description"],
  schema: z
    .object({
      code: z.string().trim().min(3, "Codes need at least 3 characters.").max(40).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _ only."),
      description: z.string().trim().max(200).default(""),
      type: z.enum(["percent", "fixed"]),
      value: z.number().positive("Enter a discount amount."),
      maxDiscount: z.number().min(0).nullable().optional(),
      minSubtotal: z.number().min(0).default(0),
      startsAt: date.optional(),
      expiresAt: date.optional(),
      usageLimit: z.number().int().min(0).nullable().optional(),
      perUserLimit: z.number().int().min(0).nullable().optional(),
      categories: z.array(objectId).default([]),
      active: z.boolean().default(true),
    })
    .refine((c) => c.type !== "percent" || c.value <= 100, { message: "A percentage discount can't exceed 100.", path: ["value"] }),
});

export const banners = crudRouter(Banner, {
  permission: "content",
  sort: { placement: 1, sortOrder: 1, createdAt: -1 },
  search: ["title"],
  schema: z.object({
    placement: z.enum(["hero", "promo"]).default("hero"),
    title: z.string().trim().min(2, "Enter a headline.").max(120),
    subtitle: z.string().trim().max(240).default(""),
    ctaText: z.string().trim().max(40).default("Shop now"),
    ctaLink: z.string().trim().max(300).refine((v) => v.startsWith("/") || /^https?:\/\//.test(v), "Use a link starting with / or https://").default("/shop"),
    image: z.string().trim().max(500).default(""),
    theme: z.enum(["blue", "ink", "light", "volt"]).default("blue"),
    sortOrder: z.number().int().default(0),
    startsAt: date.optional(),
    endsAt: date.optional(),
    active: z.boolean().default(true),
  }),
});

export const testimonials = crudRouter(Testimonial, {
  permission: "content",
  sort: { sortOrder: 1, createdAt: -1 },
  search: ["name", "text"],
  schema: z.object({
    name: z.string().trim().min(2).max(80),
    location: z.string().trim().max(80).default(""),
    text: z.string().trim().min(10, "Write what the customer said (at least 10 characters).").max(600),
    rating: z.number().int().min(1).max(5).default(5),
    sample: z.boolean().default(false),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  }),
});

/* ------------------------------- reviews -------------------------------- */
export const reviews = Router();
const guard = requirePermission("reviews");

reviews.get(
  "/",
  guard,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = paginate(req.query, { defaultLimit: 25, maxLimit: 100 });
    const f = {};
    if (["pending", "approved", "rejected"].includes(req.query.status)) f.status = req.query.status;
    const [items, total] = await Promise.all([
      Review.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("product", "name slug").lean(),
      Review.countDocuments(f),
    ]);
    res.json({ success: true, items, total, page, pages: Math.ceil(total / limit) });
  })
);

reviews.patch(
  "/:id",
  guard,
  validate({ body: z.object({ status: z.enum(["pending", "approved", "rejected"]) }) }),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const r = await Review.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true });
    if (!r) throw new HttpError(404, "Review not found.");
    await recomputeRating(r.product);
    res.json({ success: true, item: r });
  })
);

reviews.delete(
  "/:id",
  guard,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const r = await Review.findByIdAndDelete(req.params.id);
    if (!r) throw new HttpError(404, "Review not found.");
    await recomputeRating(r.product);
    res.json({ success: true });
  })
);
