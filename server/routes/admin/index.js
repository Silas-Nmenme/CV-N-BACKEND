import { Router } from "express";
import dashboard from "./dashboard.js";
import products from "./products.js";
import orders from "./orders.js";
import customers from "./customers.js";
import { categories, brands } from "./catalog.js";
import { coupons, banners, testimonials, reviews } from "./marketing.js";
import { zones, settings, pages, enquiries, subscribers } from "./store.js";

const router = Router();
router.use("/", dashboard);
router.use("/products", products);
router.use("/categories", categories);
router.use("/brands", brands);
router.use("/orders", orders);
router.use("/customers", customers);
router.use("/coupons", coupons);
router.use("/banners", banners);
router.use("/testimonials", testimonials);
router.use("/reviews", reviews);
router.use("/delivery-zones", zones);
router.use("/settings", settings);
router.use("/pages", pages);
router.use("/enquiries", enquiries);
router.use("/subscribers", subscribers);

export default router;
