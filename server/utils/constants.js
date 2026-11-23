export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT (Abuja)", "Gombe",
  "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

export const ROLES = ["customer", "support", "manager", "admin"];
export const STAFF_ROLES = ["support", "manager", "admin"];

// What each staff role may do. "admin" can do everything.
export const PERMISSIONS = {
  admin: ["*"],
  manager: [
    "dashboard", "products", "catalog", "orders", "customers", "coupons",
    "reviews", "content", "delivery", "enquiries", "subscribers", "reports",
  ],
  support: ["dashboard", "orders:read", "orders:update", "customers:read", "reviews", "enquiries", "subscribers"],
};

export const ORDER_STATUSES = [
  "pending_payment", "confirmed", "processing", "dispatched", "delivered", "cancelled", "refunded",
];
export const PAYMENT_STATUSES = ["pending", "awaiting_confirmation", "paid", "failed", "refunded"];
export const PAYMENT_METHODS = ["paystack", "flutterwave", "bank_transfer"];

export const PRODUCT_CONDITIONS = ["Brand New", "UK Used", "Nigerian Used", "Refurbished", "Open Box"];

export const NG_PHONE_REGEX = /^(?:\+?234|0)[789][01]\d{8}$/;
