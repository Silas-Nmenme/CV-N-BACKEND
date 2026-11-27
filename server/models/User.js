import mongoose from "mongoose";
import { ROLES } from "../utils/constants.js";

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 40, default: "Home" },
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const cartItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    sku: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1, max: 20 },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, default: "" },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "customer", index: true },
    status: { type: String, enum: ["active", "suspended"], default: "active", index: true },
    addresses: { type: [addressSchema], default: [] },
    wishlist: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] },
    cart: { type: [cartItemSchema], default: [] },
    sessionVersion: { type: Number, default: 0 },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: Date,
    newsletter: { type: Boolean, default: false },
    // Email verification. Default is TRUE so every existing account (which has no such field) and every staff-created account counts as
    // verified; signup sets it to false explicitly while it waits for the emailed code.
    emailVerified: { type: Boolean, default: true },
    emailVerifiedAt: Date,
    emailOtpHash: { type: String, select: false },
    emailOtpExpires: { type: Date, select: false },
    emailOtpAttempts: { type: Number, default: 0, select: false },
    emailOtpSentAt: { type: Date, select: false },
    emailOtpSendCount: { type: Number, default: 0, select: false },
    emailOtpWindowStart: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    status: this.status,
    addresses: this.addresses,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt,
    emailVerified: this.emailVerified !== false,
  };
};

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
