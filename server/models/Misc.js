import mongoose from "mongoose";

const { Schema } = mongoose;

/* Newsletter */
const subscriberSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    active: { type: Boolean, default: true, index: true },
    unsubscribeToken: { type: String, required: true },
    source: { type: String, default: "website" },
  },
  { timestamps: true }
);
export const Subscriber = mongoose.models.Subscriber || mongoose.model("Subscriber", subscriberSchema);

/* Contact form */
const enquirySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, default: "" },
    subject: { type: String, trim: true, maxlength: 150, default: "" },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    status: { type: String, enum: ["new", "in_progress", "resolved"], default: "new", index: true },
    adminNote: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true }
);
export const Enquiry = mongoose.models.Enquiry || mongoose.model("Enquiry", enquirySchema);

/* Homepage banners */
const bannerSchema = new Schema(
  {
    placement: { type: String, enum: ["hero", "promo"], default: "hero", index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 240, default: "" },
    ctaText: { type: String, trim: true, maxlength: 40, default: "Shop now" },
    ctaLink: { type: String, trim: true, maxlength: 300, default: "/shop" },
    image: { type: String, trim: true, default: "" },
    theme: { type: String, enum: ["blue", "ink", "light", "volt"], default: "blue" },
    sortOrder: { type: Number, default: 0 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);
export const Banner = mongoose.models.Banner || mongoose.model("Banner", bannerSchema);

/* Testimonials (curated by the admin) */
const testimonialSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    location: { type: String, trim: true, maxlength: 80, default: "" },
    text: { type: String, required: true, trim: true, maxlength: 600 },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    sample: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);
export const Testimonial = mongoose.models.Testimonial || mongoose.model("Testimonial", testimonialSchema);

/* Editable content pages (About, FAQ, policies) */
const pageSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: "", maxlength: 40000 }, // light Markdown: #, ##, lists, **bold**, links
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);
export const Page = mongoose.models.Page || mongoose.model("Page", pageSchema);

/* Singleton settings document */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "main" },
    store: {
      name: { type: String, default: "CV GADGETS" },
      tagline: { type: String, default: "Phones, laptops, tablets and chargers for Nigeria" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      whatsapp: { type: String, default: "" }, // international digits, e.g. 2348012345678
      address: { type: String, default: "" },
      openingHours: { type: String, default: "" },
      mapUrl: { type: String, default: "" },
      social: {
        instagram: { type: String, default: "" },
        facebook: { type: String, default: "" },
        tiktok: { type: String, default: "" },
        x: { type: String, default: "" },
        youtube: { type: String, default: "" },
      },
      announcement: { type: String, default: "" },
    },
    payments: {
      paystack: { type: Boolean, default: true },
      flutterwave: { type: Boolean, default: true },
      bankTransfer: { type: Boolean, default: false },
      bankName: { type: String, default: "" },
      accountName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      transferInstructions: { type: String, default: "Use your order reference as the transfer narration. We confirm payment manually, usually within working hours." },
    },
    delivery: {
      pickupEnabled: { type: Boolean, default: false },
      pickupNote: { type: String, default: "" },
    },
    shop: {
      lowStockThreshold: { type: Number, default: 3 },
      returnsWindowDays: { type: Number, default: 7 },
      freeShippingNote: { type: String, default: "" },
    },
    trust: {
      type: [{ title: String, text: String, _id: false }],
      default: [
        { title: "Secure checkout", text: "Pay with card, transfer or bank through trusted Nigerian gateways." },
        { title: "Delivery across Nigeria", text: "We ship to every state. Delivery fee is shown before you pay." },
        { title: "Warranty on every listing", text: "Warranty terms are stated clearly on each product page." },
        { title: "Chat on WhatsApp", text: "Ask about stock, specs or delivery before you buy." },
      ],
    },
  },
  { timestamps: true }
);
export const Setting = mongoose.models.Setting || mongoose.model("Setting", settingSchema);

export async function getSettings() {
  let s = await Setting.findOne({ key: "main" });
  if (!s) s = await Setting.create({ key: "main" });
  return s;
}
