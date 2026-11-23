import { Router } from "express";
import { z } from "zod";
import { Category } from "../../models/Category.js";
import { Brand } from "../../models/Brand.js";
import { Product } from "../../models/Product.js";
import { crudRouter } from "../../utils/crud.js";
import { HttpError, slugify } from "../../utils/helpers.js";
import { subtreeIds } from "../../services/categories.js";

const keyRx = /^[a-z][a-zA-Z0-9]*$/;
const specField = z.object({
  key: z.string().regex(keyRx, "Field keys start with a lowercase letter and use letters/numbers only (e.g. screenSize)."),
  label: z.string().trim().min(1).max(60),
  type: z.enum(["text", "number", "select"]).default("text"),
  options: z.array(z.string().trim().max(60)).max(60).default([]),
  unit: z.string().trim().max(12).default(""),
  filterable: z.boolean().default(false),
  group: z.string().trim().max(40).default("Specifications"),
});
const variantAttr = z.object({
  key: z.string().regex(keyRx, "Option keys start with a lowercase letter and use letters/numbers only (e.g. storage)."),
  label: z.string().trim().min(1).max(60),
  options: z.array(z.string().trim().max(60)).max(60).default([]),
  filterable: z.boolean().default(true),
  swatch: z.boolean().default(false),
});

const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter a category name.").max(80),
  slug: z.string().trim().max(90).optional(),
  parent: z.string().length(24).nullable().optional().or(z.literal("").transform(() => null)),
  description: z.string().trim().max(600).default(""),
  image: z.string().trim().max(500).default(""),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
  showInNav: z.boolean().default(true),
  navPromoted: z.boolean().default(false),
  specFields: z.array(specField).max(40).default([]),
  variantAttrs: z.array(variantAttr).max(10).default([]),
});

async function uniqueSlug(Model, base, selfId) {
  let slug = slugify(base) || "item";
  let n = 1;
  while (await Model.exists({ slug, _id: { $ne: selfId } })) slug = `${slugify(base)}-${++n}`;
  return slug;
}

export const categories = crudRouter(Category, {
  permission: "catalog",
  schema: categorySchema,
  sort: { sortOrder: 1, name: 1 },
  search: ["name", "slug"],
  async beforeSave(doc, body) {
    doc.slug = await uniqueSlug(Category, body.slug || body.name, doc._id);
    if (!body.parent) doc.parent = null;
    if (doc.parent && String(doc.parent) === String(doc._id)) throw new HttpError(400, "A category cannot be its own parent.");
    if (doc.parent && !doc.isNew) {
      const subtree = await subtreeIds(doc._id);
      if (subtree.includes(String(doc.parent))) throw new HttpError(400, "A category cannot be moved inside its own sub-category.");
    }
  },
  async afterSave(doc, req, created) {
    if (!created) await Product.updateMany({ category: doc._id }, { $set: { categoryName: doc.name } });
  },
  async beforeDelete(doc) {
    if (await Product.exists({ category: doc._id })) throw new HttpError(409, "This category still has products. Move or delete them first.");
    if (await Category.exists({ parent: doc._id })) throw new HttpError(409, "This category has sub-categories. Delete or move them first.");
  },
});

const brandSchema = z.object({
  name: z.string().trim().min(1, "Enter a brand name.").max(60),
  slug: z.string().trim().max(90).optional(),
  logo: z.string().trim().max(500).default(""),
  description: z.string().trim().max(400).default(""),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

export const brands = crudRouter(Brand, {
  permission: "catalog",
  schema: brandSchema,
  sort: { sortOrder: 1, name: 1 },
  search: ["name"],
  async beforeSave(doc, body) {
    doc.slug = await uniqueSlug(Brand, body.slug || body.name, doc._id);
  },
  async afterSave(doc, req, created) {
    if (!created) await Product.updateMany({ brand: doc._id }, { $set: { brandName: doc.name } });
  },
  async beforeDelete(doc) {
    if (await Product.exists({ brand: doc._id })) throw new HttpError(409, "This brand still has products. Move or delete them first.");
  },
});

export { uniqueSlug };
export default Router();
