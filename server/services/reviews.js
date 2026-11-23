import { Review } from "../models/Review.js";
import { Product } from "../models/Product.js";

export async function recomputeRating(productId) {
  const approved = await Review.find({ product: productId, status: "approved" }, "rating").lean();
  const count = approved.length;
  const avg = count ? approved.reduce((s, r) => s + r.rating, 0) / count : 0;
  await Product.updateOne({ _id: productId }, { $set: { ratingCount: count, ratingAvg: Math.round(avg * 10) / 10 } });
}
