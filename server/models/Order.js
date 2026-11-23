import mongoose from "mongoose";
import { ORDER_STATUSES, PAYMENT_STATUSES, PAYMENT_METHODS } from "../utils/constants.js";

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    brandName: { type: String, default: "" },
    slug: { type: String, default: "" },
    image: { type: String, default: "" },
    attrs: { type: mongoose.Schema.Types.Mixed, default: {} },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: "" },
    by: { type: String, default: "system" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    accessToken: { type: String, required: true, select: false }, // lets guests open their own confirmation/receipt
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    items: { type: [itemSchema], validate: (v) => v.length > 0 },

    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    couponCode: { type: String, default: "" },
    shippingFee: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "NGN" },

    customer: {
      fullName: { type: String, required: true },
      email: { type: String, required: true, lowercase: true, index: true },
      phone: { type: String, required: true, index: true },
    },
    shipping: {
      method: { type: String, default: "" },
      methodName: { type: String, default: "" },
      zoneName: { type: String, default: "" },
      etaText: { type: String, default: "" },
      state: { type: String, default: "" },
      city: { type: String, default: "" },
      address: { type: String, default: "" },
      notes: { type: String, default: "", maxlength: 500 },
      pickup: { type: Boolean, default: false },
    },

    payment: {
      method: { type: String, enum: PAYMENT_METHODS, required: true },
      status: { type: String, enum: PAYMENT_STATUSES, default: "pending", index: true },
      reference: { type: String, default: "", index: true }, // provider transaction reference
      amountPaid: { type: Number, default: 0 },
      paidAt: Date,
      providerTransactionId: { type: String, default: "" },
      channel: { type: String, default: "" },
      transferNote: { type: String, default: "" }, // customer's "I have paid" note for bank transfer
      confirmedBy: { type: String, default: "" },
    },

    status: { type: String, enum: ORDER_STATUSES, default: "pending_payment", index: true },
    statusHistory: { type: [historySchema], default: [] },
    dispatch: {
      courier: { type: String, default: "" },
      trackingNumber: { type: String, default: "" },
      trackingUrl: { type: String, default: "" },
      dispatchedAt: Date,
      deliveredAt: Date,
      note: { type: String, default: "" },
    },

    stockReserved: { type: Boolean, default: false },
    expiresAt: { type: Date, index: true }, // unpaid orders release stock after this
    receiptNumber: { type: String, default: "" },
    cancelReason: { type: String, default: "" },
  },
  { timestamps: true }
);

orderSchema.index({ createdAt: -1 });

export const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
export default Order;
