import bcrypt from "bcryptjs";
import { Category } from "../models/Category.js";
import { Brand } from "../models/Brand.js";
import { ShippingZone } from "../models/ShippingZone.js";
import { Page, getSettings } from "../models/Misc.js";
import { User } from "../models/User.js";
import { slugify } from "../utils/helpers.js";
import { env } from "../config/env.js";

const S = (key, label, extra = {}) => ({ key, label, type: "text", options: [], unit: "", filterable: false, group: "Specifications", ...extra });
const A = (key, label, options = [], extra = {}) => ({ key, label, options, filterable: true, swatch: false, ...extra });

const STORAGE = ["32GB", "64GB", "128GB", "256GB", "512GB", "1TB", "2TB"];
const CONDITION = ["Brand New", "UK Used", "Nigerian Used", "Refurbished", "Open Box"];
const COLOUR = A("colour", "Colour", [], { swatch: true, filterable: false });

export const CATEGORY_TREE = [
  {
    name: "Phones", description: "iPhone and Samsung Galaxy smartphones, brand new and UK used.", sortOrder: 1,
    specFields: [
      S("display", "Display", { group: "Display" }), S("chipset", "Chipset", { group: "Performance", filterable: true }), S("os", "Operating system", { group: "Performance" }),
      S("rearCamera", "Rear camera", { group: "Camera" }), S("frontCamera", "Front camera", { group: "Camera" }),
      S("battery", "Battery", { group: "Battery" }), S("charging", "Charging", { group: "Battery" }), S("sim", "SIM", { group: "Connectivity" }),
    ],
    variantAttrs: [A("storage", "Storage", STORAGE), A("ram", "RAM", ["4GB", "6GB", "8GB", "12GB", "16GB"]), COLOUR, A("condition", "Condition", CONDITION)],
  },
  {
    name: "Laptops", description: "HP, Dell, Lenovo and MacBook laptops for work, school and gaming.", sortOrder: 2,
    specFields: [
      S("processor", "Processor", { group: "Performance", filterable: true }), S("graphics", "Graphics", { group: "Performance" }), S("os", "Operating system", { group: "Performance" }),
      S("screenSize", "Screen size", { group: "Display", unit: "inch", filterable: true }), S("resolution", "Resolution", { group: "Display" }),
      S("batteryCondition", "Battery", { group: "Battery" }), S("ports", "Ports", { group: "Connectivity" }), S("weight", "Weight", { group: "Physical" }),
    ],
    variantAttrs: [A("ram", "RAM", ["4GB", "8GB", "16GB", "32GB", "64GB"]), A("storage", "Storage", ["128GB SSD", "256GB SSD", "512GB SSD", "1TB SSD", "2TB SSD"]), COLOUR, A("condition", "Condition", CONDITION)],
    children: [
      {
        name: "MacBooks", navPromoted: true, description: "MacBook Air and MacBook Pro in every chip generation.", sortOrder: 1,
        specFields: [
          S("processor", "Chip", { group: "Performance", filterable: true }), S("graphics", "Graphics", { group: "Performance" }), S("os", "Operating system", { group: "Performance" }),
          S("screenSize", "Screen size", { group: "Display", unit: "inch", filterable: true }), S("resolution", "Display", { group: "Display" }),
          S("batteryCondition", "Battery", { group: "Battery" }), S("ports", "Ports", { group: "Connectivity" }), S("weight", "Weight", { group: "Physical" }),
        ],
        variantAttrs: [A("ram", "Memory", ["8GB", "16GB", "24GB", "32GB", "64GB"]), A("storage", "Storage", ["256GB SSD", "512GB SSD", "1TB SSD", "2TB SSD"]), COLOUR, A("condition", "Condition", CONDITION)],
      },
    ],
  },
  {
    name: "Tablets", description: "iPads, Samsung Galaxy Tabs and children's learning tablets.", sortOrder: 3,
    specFields: [
      S("chipset", "Chipset", { group: "Performance" }), S("os", "Operating system", { group: "Performance" }),
      S("screenSize", "Screen size", { group: "Display", unit: "inch", filterable: true }), S("display", "Display", { group: "Display" }),
      S("connectivity", "Connectivity", { group: "Connectivity", type: "select", options: ["Wi-Fi", "Wi-Fi + Cellular"], filterable: true }),
      S("camera", "Cameras", { group: "Camera" }), S("battery", "Battery", { group: "Battery" }),
    ],
    variantAttrs: [A("storage", "Storage", STORAGE), A("ram", "RAM", ["2GB", "3GB", "4GB", "6GB", "8GB", "16GB"]), COLOUR, A("condition", "Condition", CONDITION)],
    children: [
      { name: "iPads", navPromoted: true, description: "iPad, iPad Air, iPad Pro and iPad mini.", sortOrder: 1 },
      {
        name: "Kids' Tablets", description: "Learning and entertainment tablets with parental controls.", sortOrder: 2,
        specFields: [
          S("ageRange", "Recommended age", { group: "For kids", filterable: true }), S("parentalControls", "Parental controls", { group: "For kids" }),
          S("protectiveCase", "Protective case", { group: "For kids" }), S("screenSize", "Screen size", { group: "Display", unit: "inch" }),
          S("os", "Operating system", { group: "Performance" }), S("battery", "Battery", { group: "Battery" }),
        ],
        variantAttrs: [A("storage", "Storage", ["16GB", "32GB", "64GB", "128GB"]), COLOUR, A("condition", "Condition", CONDITION)],
      },
    ],
  },
  {
    name: "Chargers & Accessories", description: "Original and compatible chargers, adapters and cables for phones, tablets and laptops.", sortOrder: 4,
    specFields: [
      S("wattage", "Charging power", { group: "Charging", type: "number", unit: "W", filterable: true }), S("connector", "Connector type", { group: "Charging", filterable: true }),
      S("compatibleDevices", "Compatible devices", { group: "Compatibility" }), S("ports", "Ports", { group: "Charging" }),
      S("cableLength", "Cable length", { group: "Physical" }), S("material", "Build", { group: "Physical" }),
    ],
    variantAttrs: [COLOUR, A("length", "Length", ["0.5m", "1m", "1.5m", "2m"], { filterable: false }), A("condition", "Condition", ["Brand New", "Original (Used)"])],
    children: [
      { name: "Phone Chargers", description: "iPhone, Samsung and USB-C fast chargers.", sortOrder: 1 },
      { name: "Laptop Chargers", description: "HP, Dell, Lenovo and MacBook power adapters.", sortOrder: 2 },
      { name: "Cables", description: "USB-C, Lightning and multi-tip charging cables.", sortOrder: 3 },
      { name: "Multi-port Chargers", description: "Charge several devices from one plug.", sortOrder: 4 },
    ],
  },
];

export const BRANDS = ["Apple", "Samsung", "HP", "Dell", "Lenovo", "Generic"];

async function upsertCategory(def, parent, order) {
  const slug = slugify(def.name.replace("'", ""));
  const data = {
    name: def.name, slug, parent: parent?._id || null, description: def.description || "", sortOrder: def.sortOrder ?? order,
    specFields: def.specFields || [], variantAttrs: def.variantAttrs || [], active: true, showInNav: true, navPromoted: !!def.navPromoted,
  };
  let cat = await Category.findOne({ slug });
  if (cat) {
    // Never overwrite templates the admin may have customised.
    cat.name = cat.name || data.name;
    if (!cat.parent && parent) cat.parent = parent._id;
    await cat.save();
  } else cat = await Category.create(data);
  let i = 0;
  for (const child of def.children || []) await upsertCategory(child, cat, ++i);
  return cat;
}

export async function seedCategories() {
  let i = 0;
  for (const def of CATEGORY_TREE) await upsertCategory(def, null, ++i);
}

export async function seedBrands() {
  let i = 0;
  for (const name of BRANDS) {
    const slug = slugify(name);
    if (!(await Brand.exists({ slug }))) await Brand.create({ name, slug, sortOrder: ++i });
  }
}

const ZONE_DEFS = [
  { name: "Lagos", states: ["Lagos"] },
  { name: "South-West (outside Lagos)", states: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"] },
  { name: "Abuja (FCT)", states: ["FCT (Abuja)"] },
  { name: "South-East and South-South", states: ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo", "Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"] },
  { name: "North and Middle Belt", states: ["Adamawa", "Bauchi", "Benue", "Borno", "Gombe", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Nasarawa", "Niger", "Plateau", "Sokoto", "Taraba", "Yobe", "Zamfara"] },
];

/**
 * Delivery fees are a business decision, so the base seed creates the zones with a N0 fee and
 * leaves them INACTIVE: checkout will say "we don't deliver there yet" until the owner reviews
 * and activates them in Admin > Delivery. (The demo seed fills in sample fees.)
 */
export async function seedZones({ demo = false } = {}) {
  if (await ShippingZone.estimatedDocumentCount()) return;
  const demoFees = [3500, 5500, 6500, 7000, 9000];
  let i = 0;
  for (const z of ZONE_DEFS) {
    await ShippingZone.create({
      name: z.name, states: z.states, sortOrder: i, active: demo,
      methods: [{ code: "standard", name: "Standard delivery", fee: demo ? demoFees[i] : 0, freeOver: null, etaMinDays: i === 0 ? 1 : 2, etaMaxDays: i === 0 ? 2 : 5 }],
    });
    i++;
  }
}

const PAGES = {
  about: ["About {{store}}", `# About {{store}}

{{store}} sells phones, laptops, tablets, iPads, MacBooks and chargers to customers across Nigeria.

## What we sell
- iPhones and Samsung Galaxy phones, brand new and UK used
- HP, Dell, Lenovo and MacBook laptops
- iPads, Samsung tablets and children's learning tablets
- Original and compatible chargers, adapters and cables

## How we do business
Every listing states the condition, specifications and warranty clearly. Prices are in Nigerian Naira and set by us. You see the delivery fee before you pay.

## Talk to us
Email {{email}} or call {{phone}}. You can also chat with us on WhatsApp from any product page.`],
  faq: ["Frequently asked questions", `# Frequently asked questions

## How do I pay?
You can pay online with a debit card or bank through Paystack or Flutterwave. Bank transfer is available when we have switched it on. Online payments are confirmed automatically once the payment provider confirms them to us.

## What does "UK Used" mean?
A device that was previously owned and used in the UK. Each listing shows the condition, and battery health where it applies.

## How long does delivery take?
The delivery time for your state is shown at checkout before you pay.

## Can I return an item?
Please read our [Returns and refunds policy](/returns-policy).

## How do I track my order?
Use [Track order](/track-order) with your order reference and the email or phone number you used at checkout. Signed-in customers can also see orders in their account.

## Is there a warranty?
Warranty terms are shown on each product page.

## I have not received my confirmation email.
Check your spam folder, then contact us at {{email}} with your order reference.`],
  "shipping-policy": ["Shipping and delivery policy", `# Shipping and delivery policy

## Where we deliver
We deliver to the states where delivery is enabled. Enter your state at checkout to see the available methods, fees and estimated delivery times.

## Delivery fees
Fees depend on your state and delivery method, and are shown before you pay. Some orders may qualify for free delivery when they reach a minimum amount.

## Processing
Orders are processed after payment is confirmed. For bank transfers this happens once we confirm the transfer.

## Dispatch and tracking
When your order is dispatched you will receive an email, with courier and tracking details where available.

## Delivery problems
If your order is delayed or arrives damaged, contact {{email}} or {{phone}} with your order reference as soon as possible.`],
  "returns-policy": ["Returns and refunds policy", `# Returns and refunds policy

## Return window
You may request a return within {{returnDays}} days of delivery if the item is faulty or not as described.

## Before you return
Contact us at {{email}} with your order reference. Do not send an item back before we have approved the return.

## Condition of returns
Returned items must include all original accessories and packaging, and must not have been tampered with or damaged by misuse.

## Refunds
Approved refunds are paid back to the original payment method or bank account. Refund timing depends on your bank or payment provider.

## Items that are not eligible
Items damaged by misuse, liquid damage or unauthorised repair are not eligible for a return.`],
  "privacy-policy": ["Privacy policy", `# Privacy policy

{{store}} respects your privacy. This page explains what we collect and why.

## What we collect
- Account details: name, email, phone number and delivery addresses
- Order details: items bought, amounts and delivery information
- Messages you send us through the contact form or newsletter sign-up

## How we use it
We use your details to process orders, deliver products, send order updates, provide support and, if you opt in, send offers. We do not sell your personal information.

## Payments
Card and bank payments are handled by Paystack and Flutterwave. We never see or store your full card details.

## Your choices
You can update your details in your account, unsubscribe from marketing emails at any time, or ask us to delete your account by emailing {{email}}.

## Security
Passwords are stored in hashed form and all payments are processed over encrypted connections.`],
  terms: ["Terms and conditions", `# Terms and conditions

By using this website and placing an order you agree to these terms.

## Orders and pricing
All prices are in Nigerian Naira. An order is confirmed once payment is verified. We may cancel an order if an item is unavailable or a pricing error has occurred, and will refund any payment made.

## Product descriptions
We describe condition, specifications and warranty as accurately as we can. Colours may look slightly different on your screen.

## Payment
Online payments are processed by Paystack and Flutterwave. Bank transfer orders are confirmed manually and may be cancelled if payment is not received in the stated time.

## Delivery and returns
See our [Shipping and delivery policy](/shipping-policy) and [Returns and refunds policy](/returns-policy).

## Accounts
You are responsible for keeping your password safe and for activity on your account.

## Contact
Questions about these terms? Email {{email}}.`],
};

export async function seedPages() {
  for (const [slug, [title, body]] of Object.entries(PAGES)) {
    if (!(await Page.exists({ slug }))) await Page.create({ slug, title, body });
  }
}

export async function seedAdmin(email = env.adminEmail, password = env.adminPassword, name = env.adminName) {
  if (!email || !password) return null;
  const existing = await User.findOne({ email });
  if (existing) return { created: false, user: existing };
  const user = await User.create({ name, email, role: "admin", passwordHash: await bcrypt.hash(password, 12) });
  return { created: true, user };
}

export async function seedBase({ demo = false } = {}) {
  await getSettings();
  await seedCategories();
  await seedBrands();
  await seedZones({ demo });
  await seedPages();
}
