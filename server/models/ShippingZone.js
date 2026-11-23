import mongoose from "mongoose";

const methodSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9_-]+$/ },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    fee: { type: Number, required: true, min: 0 },
    freeOver: { type: Number, min: 0, default: null }, // order subtotal at/above which this method is free
    etaMinDays: { type: Number, min: 0, default: null },
    etaMaxDays: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

const zoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    states: { type: [String], default: [] },
    methods: { type: [methodSchema], validate: (v) => v.length > 0 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const ShippingZone = mongoose.models.ShippingZone || mongoose.model("ShippingZone", zoneSchema);
export default ShippingZone;
