import mongoose from "mongoose";

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    logo: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, maxlength: 400, default: "" },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const Brand = mongoose.models.Brand || mongoose.model("Brand", brandSchema);
export default Brand;
