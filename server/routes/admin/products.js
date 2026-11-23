import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { z } from "zod";
import { Product } from "../../models/Product.js";
import { Category } from "../../models/Category.js";
import { Brand } from "../../models/Brand.js";
import { getSettings } from "../../models/Misc.js";
import { requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler, HttpError, escapeRegex, paginate, slugify } from "../../utils/helpers.js";
import { subtreeIds, effectiveTemplate } from "../../services/categories.js";
import { saveImage } from "../../services/images.js";
import { uniqueSlug } from "./catalog.js";

const router = Router();
const guard = requirePermission("products");

const variantSchema = z
  .object({
    sku: z.string().trim().min(1, "Every variant needs a SKU.").max(60),
    attrs: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), z.string().trim().max(80)).default({}),
    price: z.number({ invalid_type_error: "Enter a price in naira." }).min(0).max(1_000_000_000),
    comparePrice: z.number().min(0).max(1_000_000_000).nullable().optional(),
    stock: z.number().int("Stock must be a whole number.").min(0).max(100000),
    batteryHealth: z.number().min(0).max(100).nullable().optional(),
    image: z.string().max(500).optional(),
    active: z.boolean().default(true),
  })
  .refine((v) => v.comparePrice == null || v.comparePrice === 0 || v.comparePrice > v.price, { message: "The original (compare) price must be higher than the selling price.", path: ["comparePrice"] });

const productSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name.").max(180),
  slug: z.string().trim().max(120).optional(),
  brand: z.string().length(24, "Choose a brand."),
  category: z.string().length(24, "Choose a category."),
  series: z.string().trim().max(80).default(""),
  model: z.string().trim().max(120).default(""),
  description: z.string().trim().max(6000).default(""),
  highlights: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  specs: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), z.union([z.string().max(300), z.number()])).default({}),
  warranty: z.string().trim().max(400).default(""),
  network: z.string().trim().max(120).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  images: z.array(z.object({ url: z.string().min(1).max(600), thumb: z.string().max(600).default(""), alt: z.string().max(160).default(""), publicId: z.string().max(300).default("") })).max(12).default([]),
  variants: z.array(variantSchema).min(1, "Add at least one variant (price and stock).").max(60),
  featured: z.boolean().default(false),
  bestseller: z.boolean().default(false),
  newArrival: z.boolean().default(false),
  onOffer: z.boolean().default(false),
  active: z.boolean().default(true),
  lowStockThreshold: z.number().int().min(0).max(1000).optional(),
});

async function applyBody(doc, body) {
  const [brand, category] = await Promise.all([Brand.findById(body.brand), Category.findById(body.category)]);
  if (!brand) throw new HttpError(400, "That brand no longer exists.");
  if (!category) throw new HttpError(400, "That category no longer exists.");
  const skus = body.variants.map((v) => v.sku.toUpperCase());
  if (new Set(skus).size !== skus.length) throw new HttpError(400, "Each variant needs its own unique SKU.");

  // Keep only the spec keys that the category template knows, plus any the admin typed freely.
  doc.set({
    name: body.name, brand: brand._id, category: category._id, brandName: brand.name, categoryName: category.name,
    series: body.series, model: body.model, description: body.description, highlights: body.highlights, specs: body.specs,
    warranty: body.warranty, network: body.network, tags: body.tags, images: body.images, variants: body.variants.map((v) => ({ ...v, sku: v.sku.toUpperCase(), comparePrice: v.comparePrice || null })),
    featured: body.featured, bestseller: body.bestseller, newArrival: body.newArrival, onOffer: body.onOffer, active: body.active,
  });
  doc.markModified("specs");
  doc.lowStockThreshold = body.lowStockThreshold ?? (await getSettings()).shop.lowStockThreshold;
  doc.slug = await uniqueSlug(Product, body.slug || body.name + (body.model && !body.name.includes(body.model) ? " " + body.model : ""), doc._id);
}

/* list */
router.get(
  "/",
  guard,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = paginate(req.query, { defaultLimit: 25, maxLimit: 100 });
    const f = {};
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), "i");
      f.$or = [{ name: rx }, { model: rx }, { brandName: rx }, { "variants.sku": rx }];
    }
    if (req.query.category) {
      const cat = await Category.findOne({ slug: req.query.category }, "_id").lean();
      f.category = { $in: cat ? await subtreeIds(cat._id) : [] };
    }
    if (req.query.brand && mongoose.isValidObjectId(req.query.brand)) f.brand = req.query.brand;
    if (req.query.status === "active") f.active = true;
    if (req.query.status === "inactive") f.active = false;
    if (req.query.stock === "out") f.totalStock = 0;
    const sort = req.query.sort === "stock" ? { totalStock: 1 } : req.query.sort === "price" ? { minPrice: -1 } : { updatedAt: -1 };
    let items = await Product.find(f).sort(sort).skip(skip).limit(limit).lean();
    let total = await Product.countDocuments(f);
    if (req.query.stock === "low") {
      const all = await Product.find({ ...f, totalStock: { $gt: 0 } }, "name slug brandName images variants lowStockThreshold totalStock minPrice maxPrice active").lean();
      const low = all.filter((p) => p.variants.some((v) => v.active !== false && v.stock > 0 && v.stock <= p.lowStockThreshold));
      total = low.length;
      items = low.slice(skip, skip + limit);
    }
    res.json({ success: true, items, total, page, pages: Math.ceil(total / limit) });
  })
);

/* form helper: template for a category (spec fields + variant options) */
router.get(
  "/template/:categoryId",
  guard,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.categoryId)) throw new HttpError(400, "Invalid category.");
    res.json({ success: true, template: await effectiveTemplate(req.params.categoryId) });
  })
);

/* images */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|avif)$/.test(file.mimetype)) return cb(null, true);
    cb(new HttpError(400, "Only JPG, PNG, WebP or AVIF images are allowed."));
  },
});

router.post(
  "/upload",
  guard,
  upload.array("images", 8),
  asyncHandler(async (req, res) => {
    if (!req.files?.length) throw new HttpError(400, "Choose at least one image.");
    const folder = ["products", "banners", "brands", "categories"].includes(req.query.folder) ? req.query.folder : "products";
    const images = [];
    for (const f of req.files) images.push(await saveImage(f.buffer, { folder, max: folder === "banners" ? 2000 : 1400 }));
    res.status(201).json({ success: true, images });
  })
);

router.get(
  "/:id",
  guard,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const p = await Product.findById(req.params.id).lean();
    if (!p) throw new HttpError(404, "Product not found.");
    res.json({ success: true, item: p });
  })
);

router.post(
  "/",
  guard,
  validate({ body: productSchema }),
  asyncHandler(async (req, res) => {
    const doc = new Product();
    await applyBody(doc, req.body);
    await doc.save();
    res.status(201).json({ success: true, item: doc });
  })
);

router.put(
  "/:id",
  guard,
  validate({ body: productSchema }),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const doc = await Product.findById(req.params.id);
    if (!doc) throw new HttpError(404, "Product not found.");
    await applyBody(doc, req.body);
    await doc.save();
    res.json({ success: true, item: doc });
  })
);

// Quick inline changes from the product table.
router.patch(
  "/:id/quick",
  guard,
  validate({ body: z.object({ active: z.boolean().optional(), featured: z.boolean().optional(), bestseller: z.boolean().optional(), newArrival: z.boolean().optional(), onOffer: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const doc = await Product.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!doc) throw new HttpError(404, "Product not found.");
    res.json({ success: true, item: doc });
  })
);

// Adjust stock for one variant without opening the whole form.
router.patch(
  "/:id/stock",
  guard,
  validate({ body: z.object({ sku: z.string().min(1), stock: z.number().int().min(0).max(100000) }) }),
  asyncHandler(async (req, res) => {
    const doc = await Product.findById(req.params.id);
    if (!doc) throw new HttpError(404, "Product not found.");
    const v = doc.variants.find((x) => x.sku === req.body.sku);
    if (!v) throw new HttpError(404, "Variant not found.");
    v.stock = req.body.stock;
    await doc.save();
    res.json({ success: true, item: doc });
  })
);

router.delete(
  "/:id",
  guard,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
    const r = await Product.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) throw new HttpError(404, "Product not found.");
    res.json({ success: true });
  })
);

export default router;
