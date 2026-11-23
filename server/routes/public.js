import { Router } from "express";
import { z } from "zod";
import { Banner, Testimonial, Page, Subscriber, Enquiry, getSettings } from "../models/Misc.js";
import { Review } from "../models/Review.js";
import { strictLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, HttpError, randomToken, normalizeNgPhone } from "../utils/helpers.js";
import { NIGERIAN_STATES } from "../utils/constants.js";
import { availablePaymentMethods } from "../services/payments.js";
import { sendContactNotification } from "../services/mailer.js";

const router = Router();

router.get(
  "/config",
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    const methods = await availablePaymentMethods();
    const wa = String(s.store.whatsapp || "").replace(/\D/g, "");
    res.set("Cache-Control", req.get("Origin") ? "private, no-store" : "public, max-age=30");
    res.json({
      success: true,
      store: { ...s.store.toObject(), whatsapp: wa },
      payments: {
        methods,
        bank: methods.includes("bank_transfer") ? { bankName: s.payments.bankName, accountName: s.payments.accountName, accountNumber: s.payments.accountNumber, instructions: s.payments.transferInstructions } : null,
      },
      delivery: s.delivery,
      shop: { returnsWindowDays: s.shop.returnsWindowDays },
      trust: s.trust,
      states: NIGERIAN_STATES,
      currency: { code: "NGN", symbol: "₦" },
    });
  })
);

router.get(
  "/content/home",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const banners = (await Banner.find({ active: true }).sort({ sortOrder: 1, createdAt: -1 }).lean()).filter(
      (b) => (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt >= now)
    );
    const testimonials = await Testimonial.find({ active: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(9).lean();
    let reviews = [];
    if (!testimonials.length) {
      reviews = (await Review.find({ status: "approved", rating: { $gte: 4 }, body: { $ne: "" } }).sort({ createdAt: -1 }).limit(6).lean()).map((r) => ({
        name: r.authorName.split(" ")[0], text: r.body.slice(0, 280), rating: r.rating,
      }));
    }
    res.set("Cache-Control", req.get("Origin") ? "private, no-store" : "public, max-age=30");
    res.json({
      success: true,
      hero: banners.filter((b) => b.placement === "hero"),
      promo: banners.filter((b) => b.placement === "promo"),
      testimonials: testimonials.length ? testimonials.map((t) => ({ name: t.name, location: t.location, text: t.text, rating: t.rating, sample: t.sample })) : reviews,
    });
  })
);

router.get(
  "/pages/:slug",
  asyncHandler(async (req, res) => {
    const page = await Page.findOne({ slug: String(req.params.slug).toLowerCase() }).lean();
    if (!page) throw new HttpError(404, "Page not found.");
    const s = await getSettings();
    // Tokens such as {{store}} and {{returnDays}} are filled in so policies follow the admin's settings.
    const fill = (t) =>
      t.replaceAll("{{store}}", s.store.name).replaceAll("{{email}}", s.store.email || "our support email").replaceAll("{{phone}}", s.store.phone || "our phone line").replaceAll("{{returnDays}}", String(s.shop.returnsWindowDays));
    res.json({ success: true, page: { slug: page.slug, title: page.title, body: fill(page.body), updatedAt: page.updatedAt } });
  })
);

router.post(
  "/newsletter/subscribe",
  strictLimiter,
  validate({ body: z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254) }) }),
  asyncHandler(async (req, res) => {
    const existing = await Subscriber.findOne({ email: req.body.email });
    if (existing) {
      if (!existing.active) await Subscriber.updateOne({ _id: existing._id }, { $set: { active: true } });
    } else {
      await Subscriber.create({ email: req.body.email, unsubscribeToken: randomToken(16) });
    }
    res.json({ success: true, message: "You're subscribed. Thanks for joining!" });
  })
);

router.post(
  "/newsletter/unsubscribe",
  validate({ body: z.object({ email: z.string().trim().toLowerCase().email(), token: z.string().min(10).max(100) }) }),
  asyncHandler(async (req, res) => {
    const r = await Subscriber.updateOne({ email: req.body.email, unsubscribeToken: req.body.token }, { $set: { active: false } });
    if (!r.matchedCount) throw new HttpError(400, "This unsubscribe link is not valid.");
    res.json({ success: true, message: "You have been unsubscribed." });
  })
);

router.post(
  "/contact",
  strictLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(2, "Enter your name.").max(100),
      email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
      phone: z.string().trim().max(20).optional().transform((v, ctx) => {
        if (!v) return "";
        const n = normalizeNgPhone(v);
        if (!n) { ctx.addIssue({ code: "custom", message: "Enter a valid Nigerian phone number." }); return z.NEVER; }
        return n;
      }),
      subject: z.string().trim().max(150).optional(),
      message: z.string().trim().min(10, "Please write at least 10 characters.").max(4000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const enq = await Enquiry.create(req.body);
    sendContactNotification(enq).catch(() => {});
    res.status(201).json({ success: true, message: "Thanks! We've received your message and will reply soon." });
  })
);

export default router;
