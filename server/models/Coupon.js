import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 200, default: "" },
    type: { type: String, enum: ["percent", "fixed"], required: true },
    value: { type: Number, required: true, min: 0 },
    maxDiscount: { type: Number, min: 0, default: null }, // cap for percentage coupons
    minSubtotal: { type: Number, min: 0, default: 0 },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    usageLimit: { type: Number, min: 0, default: null },
    perUserLimit: { type: Number, min: 0, default: 1 },
    usedCount: { type: Number, default: 0 },
    categories: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }], default: [] }, // empty = whole cart
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const Coupon = mongoose.models.Coupon || mongoose.model("Coupon", couponSchema);
export default Coupon;
