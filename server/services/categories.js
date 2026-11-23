import { Category } from "../models/Category.js";

/** All category ids in the subtree rooted at `rootId` (inclusive). */
export async function subtreeIds(rootId) {
  const all = await Category.find({}, "_id parent").lean();
  const children = new Map();
  for (const c of all) {
    const k = c.parent ? String(c.parent) : "root";
    if (!children.has(k)) children.set(k, []);
    children.get(k).push(String(c._id));
  }
  const out = [];
  const stack = [String(rootId)];
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    stack.push(...(children.get(id) || []));
  }
  return out;
}

/** The category's own template, falling back to its nearest ancestor that has one. */
export async function effectiveTemplate(categoryId) {
  let cat = await Category.findById(categoryId).lean();
  const seen = new Set();
  while (cat && !seen.has(String(cat._id))) {
    seen.add(String(cat._id));
    if ((cat.specFields?.length || 0) > 0 || (cat.variantAttrs?.length || 0) > 0) {
      return { specFields: cat.specFields || [], variantAttrs: cat.variantAttrs || [] };
    }
    cat = cat.parent ? await Category.findById(cat.parent).lean() : null;
  }
  return { specFields: [], variantAttrs: [] };
}

export async function ancestorIds(categoryId) {
  const out = [];
  let cat = await Category.findById(categoryId, "_id parent").lean();
  const seen = new Set();
  while (cat && !seen.has(String(cat._id))) {
    seen.add(String(cat._id));
    out.push(String(cat._id));
    cat = cat.parent ? await Category.findById(cat.parent, "_id parent").lean() : null;
  }
  return out;
}
