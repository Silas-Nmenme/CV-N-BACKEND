import { Router } from "express";
import { Order } from "../../models/Order.js";
import { Product } from "../../models/Product.js";
import { User } from "../../models/User.js";
import { Enquiry, getSettings } from "../../models/Misc.js";
import { Review } from "../../models/Review.js";
import { requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../utils/helpers.js";
import { publicOrder } from "../../services/orders.js";

const router = Router();
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

function revenueOrders(extra = {}) {
  return { "payment.status": "paid", status: { $nin: ["refunded"] }, ...extra };
}

router.get(
  "/stats",
  requirePermission("dashboard"),
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
    const since = new Date(Date.now() - days * 86400000);
    const settings = await getSettings();

    const [paidOrders, totalOrders, pendingOrders, customers, products, activeProducts, recent, pendingReviews, newEnquiries, awaitingConfirm] = await Promise.all([
      Order.find(revenueOrders(), "total createdAt payment.paidAt payment.method items shipping.state").lean(),
      Order.countDocuments({}),
      Order.countDocuments({ status: "pending_payment" }),
      User.countDocuments({ role: "customer" }),
      Product.countDocuments({}),
      Product.find({ active: true }, "name slug brandName images variants lowStockThreshold totalStock").lean(),
      Order.find({}).sort({ createdAt: -1 }).limit(8),
      Review.countDocuments({ status: "pending" }),
      Enquiry.countDocuments({ status: "new" }),
      Order.countDocuments({ "payment.status": "awaiting_confirmation" }),
    ]);

    const revenue = paidOrders.reduce((s, o) => s + o.total, 0);
    const series = new Map();
    for (let i = days - 1; i >= 0; i--) series.set(dayKey(Date.now() - i * 86400000), { date: dayKey(Date.now() - i * 86400000), orders: 0, revenue: 0 });
    const byMethod = {};
    const topMap = new Map();
    const byState = {};
    for (const o of paidOrders) {
      const k = dayKey(o.payment?.paidAt || o.createdAt);
      if (series.has(k)) {
        const row = series.get(k);
        row.orders++;
        row.revenue += o.total;
      }
      if (new Date(o.payment?.paidAt || o.createdAt) >= since) {
        byMethod[o.payment.method] = (byMethod[o.payment.method] || 0) + o.total;
        byState[o.shipping.state] = (byState[o.shipping.state] || 0) + o.total;
        for (const it of o.items) {
          const t = topMap.get(String(it.product)) || { name: it.name, qty: 0, revenue: 0 };
          t.qty += it.quantity;
          t.revenue += it.lineTotal;
          topMap.set(String(it.product), t);
        }
      }
    }

    const low = [];
    const out = [];
    for (const p of activeProducts) {
      const thr = p.lowStockThreshold ?? settings.shop.lowStockThreshold;
      if (p.totalStock <= 0) out.push({ id: String(p._id), name: p.name, brandName: p.brandName });
      else {
        const lowVariants = p.variants.filter((v) => v.active !== false && v.stock > 0 && v.stock <= thr);
        if (lowVariants.length) low.push({ id: String(p._id), name: p.name, brandName: p.brandName, variants: lowVariants.map((v) => ({ sku: v.sku, stock: v.stock, attrs: v.attrs })) });
      }
    }

    res.json({
      success: true,
      totals: { revenue, sales: paidOrders.length, orders: totalOrders, pendingOrders, customers, products, awaitingConfirm, pendingReviews, newEnquiries },
      periodDays: days,
      series: [...series.values()],
      byMethod,
      byState: Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([state, revenue]) => ({ state, revenue })),
      topProducts: [...topMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
      lowStock: low.slice(0, 15),
      outOfStock: out.slice(0, 15),
      lowStockCount: low.length,
      outOfStockCount: out.length,
      recentOrders: recent.map((o) => ({ ...publicOrder(o) })),
    });
  })
);

router.get(
  "/reports/sales",
  requirePermission("reports"),
  asyncHandler(async (req, res) => {
    const from = req.query.from && !Number.isNaN(Date.parse(req.query.from)) ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to && !Number.isNaN(Date.parse(req.query.to)) ? new Date(new Date(req.query.to).getTime() + 86399999) : new Date();
    const group = req.query.groupBy === "month" ? "month" : "day";
    const orders = await Order.find(revenueOrders({ "payment.paidAt": { $gte: from, $lte: to } }), "total subtotal discount shippingFee payment.paidAt payment.method items").lean();
    const rows = new Map();
    for (const o of orders) {
      const k = group === "month" ? dayKey(o.payment.paidAt).slice(0, 7) : dayKey(o.payment.paidAt);
      const r = rows.get(k) || { period: k, orders: 0, units: 0, subtotal: 0, discount: 0, delivery: 0, revenue: 0 };
      r.orders++;
      r.units += o.items.reduce((s, i) => s + i.quantity, 0);
      r.subtotal += o.subtotal;
      r.discount += o.discount;
      r.delivery += o.shippingFee;
      r.revenue += o.total;
      rows.set(k, r);
    }
    const data = [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
    if (req.query.format === "csv") {
      res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="sales-report.csv"' });
      return res.send("period,orders,units,subtotal,discount,delivery,revenue\r\n" + data.map((r) => [r.period, r.orders, r.units, r.subtotal, r.discount, r.delivery, r.revenue].join(",")).join("\r\n"));
    }
    res.json({ success: true, from, to, groupBy: group, rows: data, totals: data.reduce((t, r) => ({ orders: t.orders + r.orders, units: t.units + r.units, revenue: t.revenue + r.revenue, discount: t.discount + r.discount }), { orders: 0, units: 0, revenue: 0, discount: 0 }) });
  })
);

export default router;
