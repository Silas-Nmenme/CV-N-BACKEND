import mongoose from "mongoose";

/** One row per payment attempt, giving a full transaction history per order. */
const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderReference: { type: String, required: true, index: true },
    provider: { type: String, enum: ["paystack", "flutterwave", "bank_transfer"], required: true },
    reference: { type: String, required: true, unique: true },
    amount: { type: Number, required: true }, // naira
    currency: { type: String, default: "NGN" },
    status: { type: String, enum: ["initiated", "success", "failed", "abandoned"], default: "initiated", index: true },
    providerTransactionId: { type: String, default: "" },
    channel: { type: String, default: "" },
    gatewayMessage: { type: String, default: "" },
    verifiedAt: Date,
    events: {
      type: [{ type: { type: String }, note: String, at: { type: Date, default: Date.now }, _id: false }],
      default: [],
    },
  },
  { timestamps: true }
);

export const Payment = mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
export default Payment;
