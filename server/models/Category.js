import mongoose from "mongoose";

/**
 * A category carries its own "template":
 *  - specFields: the technical specifications shown/entered for products in it
 *  - variantAttrs: the dimensions a variant can differ by (storage, colour, ...)
 * So a phone never shows laptop fields, and admins can change templates in the
 * dashboard without touching source code.
 */
const specFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, match: /^[a-z][a-zA-Z0-9]*$/ },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: ["text", "number", "select"], default: "text" },
    options: { type: [String], default: [] },
    unit: { type: String, trim: true, maxlength: 12, default: "" },
    filterable: { type: Boolean, default: false },
    group: { type: String, trim: true, maxlength: 40, default: "Specifications" },
  },
  { _id: false }
);

const variantAttrSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, match: /^[a-z][a-zA-Z0-9]*$/ },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    options: { type: [String], default: [] }, // suggestions for the admin form
    filterable: { type: Boolean, default: true },
    swatch: { type: Boolean, default: false }, // render as colour chips
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    description: { type: String, trim: true, maxlength: 600, default: "" },
    image: { type: String, trim: true, default: "" },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
    showInNav: { type: Boolean, default: true },
    navPromoted: { type: Boolean, default: false }, // show a sub-category as its own item in the main menu
    specFields: { type: [specFieldSchema], default: [] },
    variantAttrs: { type: [variantAttrSchema], default: [] },
  },
  { timestamps: true }
);

export const Category = mongoose.models.Category || mongoose.model("Category", categorySchema);
export default Category;
