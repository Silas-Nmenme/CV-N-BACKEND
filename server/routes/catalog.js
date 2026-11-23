import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Category } from "../models/Category.js";
import { Brand } from "../models/Brand.js";
import { Product } from "../models/Product.js";
import { Review } from "../models/Review.js";
import { Order } from "../models/Order.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, HttpError, escapeRegex, paginate } from "../utils/helpers.js";
import { subtreeIds, effectiveTemplate } from "../services/categories.js";
import { cardShape } from "./account.js";
import { recomputeRating } from "../services/reviews.js";

const router = Router();

/* ------------------------- categories & brands -------------------------- */
router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const cats = await Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    const byId = new Map(cats.map((c) => [String(c._id), { ...slim(c), children: [] }]));
    const roots = [];
    for (const c of cats) {
      const node = byId.get(String(c._id));
      const parent = c.parent && byId.get(String(c.parent));
      if (parent) parent.children.push(node);
      else if (!c.parent) roots.push(node);
    }
    res.set("Cache-Control", "public, max-age=60");
    res.json({ success: true, categories: roots });
  })
);

function slim(c) {
  return { id: String(c._id), name: c.name, slug: c.slug, description: c.description, image: c.image, showInNav: c.showInNav, navPromoted: !!c.navPromoted, parent: c.parent ? String(c.parent) : null };
}

router.get(
  "/brands",
  asyncHandler(async (req, res) => {
    const brands = await Brand.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    res.set("Cache-Control", "public, max-age=60");
    res.json({ success: true, brands: brands.map((b) => ({ id: String(b._id), name: b.name, slug: b.slug, logo: b.logo, description: b.description })) });
  })
);

/* ------------------------------- listing -------------------------------- */
const csv = (v) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20) : []);
const flag = (v) => v === "1" || v === "true";

async function buildFilter(q) {
  const filter = { active: true };

  if (q.category) {
    const cat = await Category.findOne({ slug: String(q.category).toLowerCase(), active: true }, "_id").lean();
    if (!cat) return { filter: null };
    filter.category = { $in: await subtreeIds(cat._id) };
  }
  if (q.brand) {
    const brands = await Brand.find({ slug: { $in: csv(q.brand).map((s) => s.toLowerCase()) } }, "_id").lean();
    if (!brands.length) return { filter: null };
    filter.brand = { $in: brands.map((b) => b._id) };
  }
  if (q.series) filter.series = { $in: csv(q.series) };
  if (flag(q.featured)) filter.featured = true;
  if (flag(q.bestseller)) filter.bestseller = true;
  if (flag(q.newArrival)) filter.newArrival = true;
  if (flag(q.onOffer)) filter.onOffer = true;

  if (q.q) {
    const tokens = String(q.q).trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (tokens.length) {
      filter.$and = tokens.map((t) => {
        const rx = new RegExp(escapeRegex(t), "i");
        return { $or: [{ name: rx }, { model: rx }, { series: rx }, { brandName: rx }, { categoryName: rx }, { tags: rx }] };
      });
    }
  }

  // Variant-level filters must hold on the SAME variant (e.g. 256GB *and* UK Used).
  const vm = { active: { $ne: false } };
  let hasVariantFilter = false;
  const min = Number(q.minPrice), max = Number(q.maxPrice);
  if (Number.isFinite(min) && q.minPrice !== undefined && q.minPrice !== "") (vm.price ||= {}).$gte = min, (hasVariantFilter = true);
  if (Number.isFinite(max) && q.maxPrice !== undefined && q.maxPrice !== "") (vm.price ||= {}).$lte = max, (hasVariantFilter = true);
  if (flag(q.inStock)) (vm.stock = { $gt: 0 }), (hasVariantFilter = true);
  for (const [key, val] of Object.entries(q)) {
    if (key.startsWith("attr_") && /^[a-zA-Z0-9]+$/.test(key.slice(5))) {
      const vals = csv(val);
      if (vals.length) vm[`attrs.${key.slice(5)}`] = { $in: vals }, (hasVariantFilter = true);
    }
    if (key.startsWith("spec_") && /^[a-zA-Z0-9]+$/.test(key.slice(5))) {
      const vals = csv(val);
      if (vals.length) filter[`specs.${key.slice(5)}`] = { $in: vals };
    }
  }
  if (hasVariantFilter) filter.variants = { $elemMatch: vm };
  return { filter };
}

const SORTS = {
  newest: { createdAt: -1 },
  price_asc: { minPrice: 1, _id: 1 },
  price_desc: { minPrice: -1, _id: 1 },
  bestselling: { soldCount: -1, createdAt: -1 },
  rating: { ratingAvg: -1, ratingCount: -1 },
  featured: { featured: -1, createdAt: -1 },
};

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const { filter } = await buildFilter(req.query);
    const { page, limit, skip } = paginate(req.query, { defaultLimit: 24, maxLimit: 60 });
    if (!filter) return res.json({ success: true, products: [], total: 0, page, pages: 0 });
    const sort = SORTS[req.query.sort] || SORTS.featured;
    const [products, total] = await Promise.all([Product.find(filter).sort(sort).skip(skip).limit(limit).lean(), Product.countDocuments(filter)]);
    res.json({ success: true, products: products.map(cardShape), total, page, pages: Math.ceil(total / limit) });
  })
);

router.get(
  "/products/facets",
  asyncHandler(async (req, res) => {
    const base = { active: true };
    let template = { specFields: [], variantAttrs: [] };
    let catDoc = null;
    if (req.query.category) {
      catDoc = await Category.findOne({ slug: String(req.query.category).toLowerCase(), active: true }).lean();
      if (!catDoc) return res.json({ success: true, brands: [], attrs: [], specs: [], price: { min: 0, max: 0 }, category: null });
      base.category = { $in: await subtreeIds(catDoc._id) };
      template = await effectiveTemplate(catDoc._id);
    } else {
      template = {
        variantAttrs: [{ key: "storage", label: "Storage" }, { key: "ram", label: "RAM" }, { key: "condition", label: "Condition" }],
        specFields: [{ key: "processor", label: "Processor", filterable: true }],
      };
    }
    if (req.query.q) {
      const tokens = String(req.query.q).trim().split(/\s+/).slice(0, 6);
      base.$and = tokens.map((t) => {
        const rx = new RegExp(escapeRegex(t), "i");
        return { $or: [{ name: rx }, { model: rx }, { series: rx }, { brandName: rx }, { categoryName: rx }, { tags: rx }] };
      });
    }

    const attrDefs = template.variantAttrs.filter((a) => a.filterable !== false);
    const specDefs = template.specFields.filter((f) => f.filterable);
    const [brandIds, ...rest] = await Promise.all([
      Product.distinct("brand", base),
      ...attrDefs.map((a) => Product.distinct(`variants.attrs.${a.key}`, base)),
      ...specDefs.map((f) => Product.distinct(`specs.${f.key}`, base)),
    ]);
    const attrVals = rest.slice(0, attrDefs.length);
    const specVals = rest.slice(attrDefs.length);

    const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
    const cmp = (key) => (key === "storage" || key === "ram" ? (a, b) => parseFloat(a) - parseFloat(b) || natural(a, b) : natural);

    const [brands, priceAgg] = await Promise.all([
      Brand.find({ _id: { $in: brandIds }, active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      Product.find(base, "minPrice maxPrice").lean(),
    ]);
    const prices = priceAgg.flatMap((p) => [p.minPrice, p.maxPrice]).filter((n) => Number.isFinite(n));

    res.json({
      success: true,
      category: catDoc ? slim(catDoc) : null,
      brands: brands.map((b) => ({ slug: b.slug, name: b.name })),
      attrs: attrDefs.map((a, i) => ({ key: a.key, label: a.label, swatch: a.swatch, values: attrVals[i].filter(Boolean).map(String).sort(cmp(a.key)) })).filter((a) => a.values.length),
      specs: specDefs.map((f, i) => ({ key: f.key, label: f.label, values: specVals[i].filter((v) => v !== "" && v != null).map(String).sort(natural) })).filter((f) => f.values.length),
      price: { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 },
    });
  })
);

// Cards for a list of ids (used by the guest wishlist stored in the browser).
router.get(
  "/products/by-ids",
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || "").split(",").filter((i) => mongoose.isValidObjectId(i)).slice(0, 60);
    const products = ids.length ? await Product.find({ _id: { $in: ids }, active: true }).lean() : [];
    res.json({ success: true, products: products.map(cardShape) });
  })
);

router.get(
  "/products/suggest",
  validate({ query: z.object({ q: z.string().trim().min(1).max(60) }).passthrough() }),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery.q;
    const { filter } = await buildFilter({ q });
    const products = await Product.find(filter, "name slug brandName images minPrice totalStock").sort({ soldCount: -1, createdAt: -1 }).limit(6).lean();
    const rx = new RegExp(escapeRegex(q), "i");
    const [cats, brands] = await Promise.all([
      Category.find({ active: true, name: rx }, "name slug").limit(3).lean(),
      Brand.find({ active: true, name: rx }, "name slug").limit(3).lean(),
    ]);
    res.json({
      success: true,
      products: products.map((p) => ({ name: p.name, slug: p.slug, brandName: p.brandName, price: p.minPrice, inStock: p.totalStock > 0, image: p.images?.[0]?.thumb || p.images?.[0]?.url || "" })),
      categories: cats.map((c) => ({ name: c.name, slug: c.slug })),
      brands: brands.map((b) => ({ name: b.name, slug: b.slug })),
    });
  })
);

/* ------------------------------- details -------------------------------- */
async function breadcrumb(categoryId) {
  const chain = [];
  let cat = await Category.findById(categoryId, "name slug parent").lean();
  const seen = new Set();
  while (cat && !seen.has(String(cat._id))) {
    seen.add(String(cat._id));
    chain.unshift({ name: cat.name, slug: cat.slug });
    cat = cat.parent ? await Category.findById(cat.parent, "name slug parent").lean() : null;
  }
  return chain;
}

function specGroups(product, template) {
  const groups = new Map();
  const seen = new Set();
  const add = (group, label, value, unit) => {
    if (value === undefined || value === null || value === "") return;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ label, value: `${value}${unit ? " " + unit : ""}` });
  };
  for (const f of template.specFields) {
    seen.add(f.key);
    add(f.group || "Specifications", f.label, product.specs?.[f.key], f.unit);
  }
  for (const [k, v] of Object.entries(product.specs || {})) {
    if (!seen.has(k)) add("More details", k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), v);
  }
  if (product.network) add("Connectivity", "Network / SIM", product.network);
  if (product.warranty) add("Warranty", "Warranty", product.warranty);
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

router.get(
  "/products/:slug",
  asyncHandler(async (req, res) => {
    const p = await Product.findOne({ slug: String(req.params.slug).toLowerCase(), active: true }).lean();
    if (!p) throw new HttpError(404, "We couldn't find that product.");
    const template = await effectiveTemplate(p.category);
    const [crumbs, brand, dist] = await Promise.all([
      breadcrumb(p.category),
      Brand.findById(p.brand, "name slug logo").lean(),
      Review.find({ product: p._id, status: "approved" }, "rating").lean(),
    ]);
    const distribution = [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: dist.filter((r) => r.rating === n).length }));
    const variants = p.variants.filter((v) => v.active !== false).map((v) => ({
      sku: v.sku, attrs: v.attrs || {}, price: v.price,
      comparePrice: v.comparePrice && v.comparePrice > v.price ? v.comparePrice : null,
      stock: v.stock, lowStock: v.stock > 0 && v.stock <= (p.lowStockThreshold ?? 3),
      batteryHealth: v.batteryHealth, image: v.image || "",
    }));
    res.json({
      success: true,
      product: {
        id: String(p._id), slug: p.slug, name: p.name, brand: brand ? { name: brand.name, slug: brand.slug } : null, series: p.series, model: p.model,
        description: p.description, highlights: p.highlights, images: p.images.map((i) => ({ url: i.url, thumb: i.thumb, alt: i.alt || p.name })),
        variants, attrDefs: template.variantAttrs, specGroups: specGroups(p, template), warranty: p.warranty, network: p.network,
        category: crumbs.at(-1) || null, breadcrumb: crumbs, minPrice: p.minPrice, maxPrice: p.maxPrice, totalStock: p.totalStock,
        ratingAvg: p.ratingAvg, ratingCount: p.ratingCount, distribution, featured: p.featured, newArrival: p.newArrival, bestseller: p.bestseller, onOffer: p.onOffer,
      },
    });
  })
);

router.get(
  "/products/:id/related",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid product.");
    const p = await Product.findById(req.params.id, "category brand series").lean();
    if (!p) return res.json({ success: true, products: [] });
    const same = await Product.find({ _id: { $ne: p._id }, active: true, category: p.category, totalStock: { $gt: 0 } }).sort({ soldCount: -1 }).limit(24).lean();
    same.sort((a, b) => score(b, p) - score(a, p));
    res.json({ success: true, products: same.slice(0, 8).map(cardShape) });
  })
);
const score = (a, p) => (String(a.brand) === String(p.brand) ? 2 : 0) + (a.series && a.series === p.series ? 3 : 0);

/* -------------------------------- reviews ------------------------------- */
router.get(
  "/products/:id/reviews",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid product.");
    const { page, limit, skip } = paginate(req.query, { defaultLimit: 8, maxLimit: 30 });
    const filter = { product: req.params.id, status: "approved" };
    const [reviews, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Review.countDocuments(filter)]);
    res.json({
      success: true, total, page, pages: Math.ceil(total / limit),
      reviews: reviews.map((r) => ({ id: String(r._id), author: r.authorName.split(" ")[0] + (r.authorName.split(" ")[1] ? ` ${r.authorName.split(" ")[1][0]}.` : ""), rating: r.rating, title: r.title, body: r.body, verifiedPurchase: r.verifiedPurchase, createdAt: r.createdAt })),
    });
  })
);

router.post(
  "/products/:id/reviews",
  requireAuth,
  validate({ body: z.object({ rating: z.number().int().min(1, "Choose a star rating.").max(5), title: z.string().trim().max(120).optional(), body: z.string().trim().min(5, "Tell others a little more (at least 5 characters).").max(2000) }) }),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid product.");
    const product = await Product.findById(req.params.id, "_id").lean();
    if (!product) throw new HttpError(404, "Product not found.");
    if (await Review.exists({ product: product._id, user: req.user._id })) throw new HttpError(409, "You have already reviewed this product.");
    const verified = Boolean(await Order.exists({ user: req.user._id, "items.product": product._id, "payment.status": "paid", status: { $nin: ["cancelled", "refunded"] } }));
    const review = await Review.create({
      product: product._id, user: req.user._id, authorName: req.user.name, rating: req.body.rating, title: req.body.title || "", body: req.body.body,
      verifiedPurchase: verified, status: verified ? "approved" : "pending",
    });
    if (verified) await recomputeRating(product._id);
    res.status(201).json({ success: true, status: review.status, message: verified ? "Thanks! Your review is live." : "Thanks! Your review will appear once our team approves it." });
  })
);

export default router;
