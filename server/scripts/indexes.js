import { User } from "../models/User.js";
import { Product } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { Category } from "../models/Category.js";
import { Brand } from "../models/Brand.js";
import { Coupon } from "../models/Coupon.js";
import { Payment } from "../models/Payment.js";
import { Review } from "../models/Review.js";
import { Subscriber, Page, Setting } from "../models/Misc.js";

/** Create indexes up front so unique constraints are enforced from the first request. */
export async function ensureIndexes() {
  for (const M of [User, Product, Order, Category, Brand, Coupon, Payment, Review, Subscriber, Page, Setting]) {
    try {
      await M.syncIndexes();
    } catch (e) {
      console.warn(`[indexes] ${M.modelName}: ${e.message}`);
    }
  }
}
