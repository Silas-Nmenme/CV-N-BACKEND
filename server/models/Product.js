import mongoose from "mongoose";

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 60 },
    attrs: { type: mongoose.Schema.Types.Mixed, default: {} }, // { storage:"256GB", ram:"8GB", colour:"Black", condition:"UK Used" }
    price: { type: Number, required: true, min: 0 },
    comparePrice: { type: Number, min: 0, default: null }, // original price; shown struck through when > price
    stock: { type: Number, required: true, min: 0, default: 0, validate: { validator: Number.isInteger, message: "Stock must be a whole number." } },
    batteryHealth: { type: Number, min: 0, max: 100, default: null },
    image: { type: String, default: "" }, // optional variant-specific image
    active: { type: Boolean, default: true },
  },
  { _id: false }
);

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    thumb: { type: String, default: "" },
    alt: { type: String, default: "", maxlength: 160 },
    publicId: { type: String, default: "" },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 180 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand", required: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    brandName: { type: String, default: "" }, // denormalised for search + cards
    categoryName: { type: String, default: "" },
    series: { type: String, trim: true, maxlength: 80, default: "" }, // "iPhone 15", "EliteBook", "Galaxy S"
    model: { type: String, trim: true, maxlength: 120, default: "" },
    description: { type: String, trim: true, maxlength: 6000, default: "" },
    highlights: { type: [String], default: [] },
    specs: { type: mongoose.Schema.Types.Mixed, default: {} },
    warranty: { type: String, trim: true, maxlength: 400, default: "" },
    network: { type: String, trim: true, maxlength: 120, default: "" }, // SIM / network notes (phones, cellular tablets)
    tags: { type: [String], default: [] },
    images: { type: [imageSchema], default: [] },
    variants: {
      type: [variantSchema],
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: "A product needs at least one variant." },
    },

    featured: { type: Boolean, default: false, index: true },
    bestseller: { type: Boolean, default: false, index: true },
    newArrival: { type: Boolean, default: false, index: true },
    onOffer: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true, index: true },
    lowStockThreshold: { type: Number, default: 3, min: 0 },

    // denormalised, kept in sync in pre-save so listing/sorting stays fast
    minPrice: { type: Number, default: 0, index: true },
    maxPrice: { type: Number, default: 0 },
    totalStock: { type: Number, default: 0, index: true },
    maxDiscountPct: { type: Number, default: 0 },
    ratingAvg: { type: Number, default: 0, index: true },
    ratingCount: { type: Number, default: 0 },
    soldCount: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

productSchema.index({ active: 1, category: 1, createdAt: -1 });
productSchema.index({ "variants.sku": 1 }, { unique: true, sparse: true });

export function computeDerived(doc) {
  const live = doc.variants.filter((v) => v.active !== false);
  const list = live.length ? live : doc.variants;
  doc.minPrice = Math.min(...list.map((v) => v.price));
  doc.maxPrice = Math.max(...list.map((v) => v.price));
  doc.totalStock = live.reduce((s, v) => s + (v.stock || 0), 0);
  doc.maxDiscountPct = Math.max(
    0,
    ...list.map((v) => (v.comparePrice && v.comparePrice > v.price ? Math.round((1 - v.price / v.comparePrice) * 100) : 0))
  );
}

productSchema.pre("validate", function (next) {
  if (this.variants?.length) computeDerived(this);
  next();
});

export const Product = mongoose.models.Product || mongoose.model("Product", productSchema);
export default Product;
