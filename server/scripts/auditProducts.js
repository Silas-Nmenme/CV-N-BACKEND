/**
 * READ-ONLY product catalogue audit.  Usage:  npm run audit:product
 * Connects with MONGO_URI from your .env, reads products, and prints problems that make storefront cards or
 * product pages look broken (missing images, images that only exist on a developer machine, no sellable variants,
 * dangling category/brand references, duplicate slugs, zero prices). It never writes, updates or deletes anything.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { Brand } from "../models/Brand.js";

const sample = (arr, n = 8) => arr.slice(0, n).map((p) => `    - ${p.name}  [${p.slug}]`).join("\n") + (arr.length > n ? `\n    … and ${arr.length - n} more` : "");
const section = (title, list, hint) => {
  console.log(`${list.length ? "⚠" : "✓"} ${title}: ${list.length}`);
  if (list.length) { console.log(sample(list)); if (hint) console.log(`  → ${hint}`); }
};

await connectDB();
const [products, cats, brands] = await Promise.all([Product.find().lean(), Category.find({}, "_id").lean(), Brand.find({}, "_id").lean()]);
const catIds = new Set(cats.map((c) => String(c._id)));
const brandIds = new Set(brands.map((b) => String(b._id)));

console.log(`\nCatalogue audit — ${products.length} product(s), ${products.filter((p) => p.active).length} visible, ${products.filter((p) => !p.active).length} hidden\n`);

section("Visible products with NO images", products.filter((p) => p.active && !(p.images || []).length), "Open each in Admin → Products and upload at least one picture.");
section(
  "Products whose images point at the server's local /uploads folder",
  products.filter((p) => (p.images || []).some((i) => (i.url || "").startsWith("/uploads/"))),
  "On Vercel the disk is not persistent, so these pictures 404 in production. Re-upload them in the admin (stored on Cloudinary)."
);
section("Visible products with NO sellable variant (all variants inactive/none)", products.filter((p) => p.active && !(p.variants || []).some((v) => v.active !== false)), "These show as unavailable. Add or re-activate a variant.");
section("Visible products with a variant priced at ₦0", products.filter((p) => p.active && (p.variants || []).some((v) => v.active !== false && !(v.price > 0))), "Check the price on each variant.");
section("Visible products that are out of stock", products.filter((p) => p.active && (p.totalStock || 0) === 0));
section("Products pointing at a category that no longer exists", products.filter((p) => !catIds.has(String(p.category))), "Re-assign a category in the admin.");
section("Products pointing at a brand that no longer exists", products.filter((p) => !brandIds.has(String(p.brand))), "Re-assign a brand in the admin.");
section("Products with no description", products.filter((p) => p.active && !(p.description || "").trim()));

const slugs = new Map();
for (const p of products) slugs.set(p.slug, [...(slugs.get(p.slug) || []), p]);
section("Duplicate slugs", [...slugs.values()].filter((l) => l.length > 1).flat());

const demo = products.filter((p) => /\/uploads\/demo\//.test(JSON.stringify(p.images || [])));
section("Products using the bundled demo artwork (/uploads/demo)", demo, "These look like sample/demo records. Delete or edit them in the admin.");

console.log("\nDone. Nothing was changed.");
await mongoose.disconnect();
