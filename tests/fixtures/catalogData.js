import fs from "node:fs/promises";
import path from "node:path";
import { Brand } from "../../server/models/Brand.js";
import { Category } from "../../server/models/Category.js";
import { Product } from "../../server/models/Product.js";
import { Coupon } from "../../server/models/Coupon.js";
import { Banner, Testimonial, getSettings } from "../../server/models/Misc.js";
import { slugify } from "../../server/utils/helpers.js";
import { uploadRoot } from "../../server/services/images.js";
import { deviceSvg } from "./deviceArt.js";

/**
 * Test-only catalogue fixtures; never imported by the application or production seed.
 */
const v = (sku, attrs, price, stock, extra = {}) => ({ sku, attrs, price, stock, ...extra });
const NEW = "Brand New", UK = "UK Used";

const iphone = (series, chip, cam, variants, flags = {}) => ({
  name: series, brand: "Apple", cat: "phones", series, model: series, kind: "iphone", color: variants[0].attrs.colour,
  specs: { display: "OLED Super Retina display", chipset: chip, os: "iOS", rearCamera: cam, frontCamera: "12MP TrueDepth", battery: "All-day battery life", charging: "USB-C / Lightning (model dependent)", sim: "Nano-SIM + eSIM" },
  warranty: "Warranty stated on the listing at purchase", network: "Factory unlocked (works on all Nigerian networks)", ...flags,
  highlights: [`${chip} chip`, "Face ID", "Tested before sale", "Battery health shown per unit"], variants,
  description: `${series} with fast performance and an excellent camera system. Condition and battery health are listed for every option, so you know exactly what you are buying.`,
});

const TEST_PRODUCTS = [
  iphone("iPhone 17 Pro", "A19 Pro", "48MP triple camera", [v("IP17P-256-NT-N", { storage: "256GB", ram: "12GB", colour: "Natural Titanium", condition: NEW }, 2150000, 6), v("IP17P-512-NT-N", { storage: "512GB", ram: "12GB", colour: "Natural Titanium", condition: NEW }, 2450000, 3), v("IP17P-256-BL-N", { storage: "256GB", ram: "12GB", colour: "Deep Blue", condition: NEW }, 2150000, 0)], { featured: true, newArrival: true }),
  iphone("iPhone 16", "A18", "48MP dual camera", [v("IP16-128-BK-N", { storage: "128GB", ram: "8GB", colour: "Black", condition: NEW }, 1250000, 8, { comparePrice: 1320000 }), v("IP16-256-PK-N", { storage: "256GB", ram: "8GB", colour: "Pink", condition: NEW }, 1420000, 4), v("IP16-128-BK-U", { storage: "128GB", ram: "8GB", colour: "Black", condition: UK }, 1020000, 5, { batteryHealth: 96 })], { featured: true, newArrival: true, bestseller: true }),
  iphone("iPhone 15 Pro Max", "A17 Pro", "48MP triple camera", [v("IP15PM-256-NT-U", { storage: "256GB", ram: "8GB", colour: "Natural Titanium", condition: UK }, 1180000, 4, { batteryHealth: 93 }), v("IP15PM-512-BK-U", { storage: "512GB", ram: "8GB", colour: "Titanium Black", condition: UK }, 1350000, 2, { batteryHealth: 91 })], { featured: true, onOffer: true }),
  iphone("iPhone 15", "A16 Bionic", "48MP dual camera", [v("IP15-128-BL-U", { storage: "128GB", ram: "6GB", colour: "Blue", condition: UK }, 690000, 7, { batteryHealth: 94, comparePrice: 740000 }), v("IP15-128-PK-N", { storage: "128GB", ram: "6GB", colour: "Pink", condition: NEW }, 880000, 3)], { bestseller: true, onOffer: true }),
  iphone("iPhone 14", "A15 Bionic", "12MP dual camera", [v("IP14-128-MD-U", { storage: "128GB", ram: "6GB", colour: "Midnight", condition: UK }, 520000, 9, { batteryHealth: 90 }), v("IP14-256-PU-U", { storage: "256GB", ram: "6GB", colour: "Purple", condition: UK }, 590000, 3, { batteryHealth: 89 })], { bestseller: true }),
  iphone("iPhone 13", "A15 Bionic", "12MP dual camera", [v("IP13-128-MD-U", { storage: "128GB", ram: "4GB", colour: "Midnight", condition: UK }, 410000, 12, { batteryHealth: 88 }), v("IP13-256-RD-U", { storage: "256GB", ram: "4GB", colour: "Red", condition: UK }, 470000, 2, { batteryHealth: 87 })], { bestseller: true }),
  iphone("iPhone 12", "A14 Bionic", "12MP dual camera", [v("IP12-64-BK-U", { storage: "64GB", ram: "4GB", colour: "Black", condition: UK }, 290000, 10, { batteryHealth: 85 }), v("IP12-128-WH-U", { storage: "128GB", ram: "4GB", colour: "White", condition: UK }, 340000, 5, { batteryHealth: 86 })]),
  iphone("iPhone 11", "A13 Bionic", "12MP dual camera", [v("IP11-64-BK-U", { storage: "64GB", ram: "4GB", colour: "Black", condition: UK }, 210000, 14, { batteryHealth: 83 }), v("IP11-128-GR-U", { storage: "128GB", ram: "4GB", colour: "Green", condition: UK }, 245000, 6, { batteryHealth: 84 })], { onOffer: true }),

  { name: "Samsung Galaxy S24 Ultra", brand: "Samsung", cat: "phones", series: "Galaxy S", model: "S24 Ultra", kind: "galaxy", color: "Titanium Gray", featured: true, bestseller: true, newArrival: true,
    specs: { display: "6.8-inch Dynamic AMOLED 2X, 120Hz", chipset: "Snapdragon 8 Gen 3", os: "Android 14 (One UI 6.1)", rearCamera: "200MP quad camera", frontCamera: "12MP", battery: "5000mAh", charging: "45W wired", sim: "Dual nano-SIM + eSIM" },
    warranty: "Warranty stated on the listing at purchase", network: "Dual SIM, 5G", highlights: ["Built-in S Pen", "200MP camera", "Titanium frame", "5000mAh battery"],
    description: "Samsung's flagship Galaxy S Ultra with S Pen, a 200MP camera and a bright 6.8-inch display.",
    variants: [v("S24U-256-GR-N", { storage: "256GB", ram: "12GB", colour: "Titanium Gray", condition: NEW }, 1480000, 5, { comparePrice: 1560000 }), v("S24U-512-BK-N", { storage: "512GB", ram: "12GB", colour: "Titanium Black", condition: NEW }, 1680000, 3), v("S24U-256-GR-U", { storage: "256GB", ram: "12GB", colour: "Titanium Gray", condition: UK }, 1150000, 2, { batteryHealth: 95 })] },
  { name: "Samsung Galaxy Z Flip5", brand: "Samsung", cat: "phones", series: "Galaxy Z", model: "Z Flip5", kind: "fold", color: "Lavender", featured: true,
    specs: { display: "6.7-inch Foldable Dynamic AMOLED 2X + 3.4-inch cover screen", chipset: "Snapdragon 8 Gen 2", os: "Android 13", rearCamera: "12MP dual camera", frontCamera: "10MP", battery: "3700mAh", charging: "25W wired", sim: "Nano-SIM + eSIM" },
    warranty: "Warranty stated on the listing at purchase", network: "5G", highlights: ["Compact flip design", "3.4-inch Flex Window", "Flex mode for hands-free shots"],
    description: "A pocketable foldable with a large cover screen for quick replies and photos.",
    variants: [v("ZF5-256-LV-U", { storage: "256GB", ram: "8GB", colour: "Lavender", condition: UK }, 640000, 3, { batteryHealth: 92 }), v("ZF5-256-MT-U", { storage: "256GB", ram: "8GB", colour: "Mint", condition: UK }, 640000, 0)] },
  { name: "Samsung Galaxy A15", brand: "Samsung", cat: "phones", series: "Galaxy A", model: "A15", kind: "galaxy", color: "Blue", bestseller: true,
    specs: { display: "6.5-inch Super AMOLED, 90Hz", chipset: "MediaTek Helio G99", os: "Android 14", rearCamera: "50MP triple camera", frontCamera: "13MP", battery: "5000mAh", charging: "25W wired", sim: "Dual nano-SIM" },
    warranty: "Warranty stated on the listing at purchase", network: "4G", highlights: ["Big AMOLED screen", "5000mAh battery", "Great value"],
    description: "An affordable everyday Galaxy with a bright AMOLED screen and a battery that lasts.",
    variants: [v("A15-128-BL-N", { storage: "128GB", ram: "4GB", colour: "Blue", condition: NEW }, 215000, 20, { comparePrice: 235000 }), v("A15-128-BK-N", { storage: "128GB", ram: "6GB", colour: "Black", condition: NEW }, 235000, 11)] },
  { name: "Samsung Galaxy M14", brand: "Samsung", cat: "phones", series: "Galaxy M", model: "M14", kind: "galaxy", color: "Green",
    specs: { display: "6.6-inch PLS LCD, 90Hz", chipset: "Exynos 1330", os: "Android 13", rearCamera: "50MP dual camera", frontCamera: "13MP", battery: "6000mAh", charging: "25W wired", sim: "Dual nano-SIM" },
    warranty: "Warranty stated on the listing at purchase", network: "5G", highlights: ["6000mAh battery", "5G ready"],
    description: "Long-lasting Galaxy M series phone built around a 6000mAh battery.",
    variants: [v("M14-128-GN-N", { storage: "128GB", ram: "6GB", colour: "Green", condition: NEW }, 195000, 8)] },

  { name: "HP EliteBook 840 G8", brand: "HP", cat: "laptops", series: "EliteBook", model: "840 G8", kind: "laptop", color: "Silver", featured: true, bestseller: true,
    specs: { processor: "Intel Core i7-1165G7", graphics: "Intel Iris Xe", os: "Windows 11 Pro", screenSize: "14", resolution: "1920 x 1080 FHD", batteryCondition: "Good, 5+ hours", ports: "2x Thunderbolt 4, HDMI, USB-A", weight: "1.36 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Business-grade aluminium build", "Backlit keyboard", "Fingerprint reader"], description: "A slim, tough business laptop that is fast enough for demanding office work.",
    variants: [v("EB840-16-512-U", { ram: "16GB", storage: "512GB SSD", colour: "Silver", condition: UK }, 560000, 6, { comparePrice: 610000 }), v("EB840-8-256-U", { ram: "8GB", storage: "256GB SSD", colour: "Silver", condition: UK }, 430000, 4)] },
  { name: "HP ProBook 450 G9", brand: "HP", cat: "laptops", series: "ProBook", model: "450 G9", kind: "laptop", color: "Grey",
    specs: { processor: "Intel Core i5-1235U", graphics: "Intel Iris Xe", os: "Windows 11 Pro", screenSize: "15.6", resolution: "1920 x 1080 FHD", batteryCondition: "Good", ports: "USB-C, USB-A, HDMI, RJ-45", weight: "1.74 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Full-size keyboard with numpad", "Large 15.6-inch display"], description: "A dependable 15.6-inch laptop for school and office.",
    variants: [v("PB450-8-256-N", { ram: "8GB", storage: "256GB SSD", colour: "Grey", condition: NEW }, 640000, 5), v("PB450-16-512-N", { ram: "16GB", storage: "512GB SSD", colour: "Grey", condition: NEW }, 760000, 2)] },
  { name: "HP Spectre x360 14", brand: "HP", cat: "laptops", series: "Spectre", model: "x360 14", kind: "laptop", color: "Midnight", newArrival: true,
    specs: { processor: "Intel Core Ultra 7", graphics: "Intel Arc", os: "Windows 11 Home", screenSize: "14", resolution: "2880 x 1800 OLED touch", batteryCondition: "New", ports: "2x Thunderbolt 4, USB-A, microSD", weight: "1.4 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["2-in-1 touchscreen", "OLED display", "Premium build"], description: "A premium 2-in-1 with a vivid OLED screen.",
    variants: [v("SPX360-16-1T-N", { ram: "16GB", storage: "1TB SSD", colour: "Midnight", condition: NEW }, 1980000, 2)] },
  { name: "Dell Latitude 7420", brand: "Dell", cat: "laptops", series: "Latitude", model: "7420", kind: "laptop", color: "Black", bestseller: true,
    specs: { processor: "Intel Core i7-1185G7", graphics: "Intel Iris Xe", os: "Windows 11 Pro", screenSize: "14", resolution: "1920 x 1080 FHD", batteryCondition: "Good, 5+ hours", ports: "2x Thunderbolt 4, HDMI, USB-A", weight: "1.37 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Lightweight business laptop", "Fast SSD", "Backlit keyboard"], description: "A light, fast business laptop that handles a full day of work.",
    variants: [v("LAT7420-16-512-U", { ram: "16GB", storage: "512GB SSD", colour: "Black", condition: UK }, 520000, 7, { comparePrice: 560000 }), v("LAT7420-8-256-U", { ram: "8GB", storage: "256GB SSD", colour: "Black", condition: UK }, 410000, 5)] },
  { name: "Dell XPS 13 9310", brand: "Dell", cat: "laptops", series: "XPS", model: "13 9310", kind: "laptop", color: "Silver", featured: true,
    specs: { processor: "Intel Core i7-1185G7", graphics: "Intel Iris Xe", os: "Windows 11 Home", screenSize: "13.4", resolution: "1920 x 1200 FHD+ touch", batteryCondition: "Good", ports: "2x Thunderbolt 4, microSD", weight: "1.2 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Edge-to-edge display", "CNC aluminium body"], description: "A compact premium ultrabook with a near-borderless display.",
    variants: [v("XPS9310-16-512-U", { ram: "16GB", storage: "512GB SSD", colour: "Silver", condition: UK }, 680000, 3)] },
  { name: "Lenovo ThinkPad T14 Gen 3", brand: "Lenovo", cat: "laptops", series: "ThinkPad", model: "T14 Gen 3", kind: "laptop", color: "Black", bestseller: true,
    specs: { processor: "Intel Core i5-1245U", graphics: "Intel Iris Xe", os: "Windows 11 Pro", screenSize: "14", resolution: "1920 x 1080 FHD", batteryCondition: "Good", ports: "2x Thunderbolt 4, HDMI, USB-A, RJ-45", weight: "1.4 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Legendary ThinkPad keyboard", "Military-grade durability tested"], description: "Tough, reliable and comfortable to type on all day.",
    variants: [v("T14G3-16-512-U", { ram: "16GB", storage: "512GB SSD", colour: "Black", condition: UK }, 590000, 6), v("T14G3-8-256-U", { ram: "8GB", storage: "256GB SSD", colour: "Black", condition: UK }, 470000, 0)] },
  { name: "Lenovo IdeaPad Slim 3", brand: "Lenovo", cat: "laptops", series: "IdeaPad", model: "Slim 3", kind: "laptop", color: "Grey", onOffer: true,
    specs: { processor: "AMD Ryzen 5 7520U", graphics: "AMD Radeon", os: "Windows 11 Home", screenSize: "15.6", resolution: "1920 x 1080 FHD", batteryCondition: "New", ports: "USB-C, 2x USB-A, HDMI", weight: "1.62 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Everyday performance", "Light 15.6-inch body"], description: "A friendly, affordable laptop for students and home use.",
    variants: [v("IPS3-8-512-N", { ram: "8GB", storage: "512GB SSD", colour: "Grey", condition: NEW }, 510000, 9, { comparePrice: 560000 })] },
  { name: "Lenovo Legion 5", brand: "Lenovo", cat: "laptops", series: "Legion", model: "Legion 5 15", kind: "laptop", color: "Black", newArrival: true,
    specs: { processor: "AMD Ryzen 7 7735HS", graphics: "NVIDIA GeForce RTX 4060", os: "Windows 11 Home", screenSize: "15.6", resolution: "1920 x 1080 165Hz", batteryCondition: "New", ports: "USB-C, 3x USB-A, HDMI, RJ-45", weight: "2.4 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["RTX 4060 graphics", "165Hz display"], description: "A powerful gaming and creator laptop with a fast 165Hz screen.",
    variants: [v("LEG5-16-512-N", { ram: "16GB", storage: "512GB SSD", colour: "Black", condition: NEW }, 1450000, 3)] },
  { name: "Lenovo Yoga 7i", brand: "Lenovo", cat: "laptops", series: "Yoga", model: "Yoga 7i 14", kind: "laptop", color: "Grey",
    specs: { processor: "Intel Core i7-1360P", graphics: "Intel Iris Xe", os: "Windows 11 Home", screenSize: "14", resolution: "2240 x 1400 touch", batteryCondition: "New", ports: "2x Thunderbolt 4, USB-A, HDMI", weight: "1.5 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["2-in-1 touch", "Sharp 2.2K display"], description: "A flexible 2-in-1 for notes, sketches and presentations.",
    variants: [v("Y7I-16-512-N", { ram: "16GB", storage: "512GB SSD", colour: "Grey", condition: NEW }, 1150000, 2)] },

  { name: "MacBook Air 13-inch M2", brand: "Apple", cat: "macbooks", series: "MacBook Air", model: "M2 2022", kind: "macbook", color: "Midnight", featured: true, bestseller: true,
    specs: { processor: "Apple M2", graphics: "8-core GPU", os: "macOS", screenSize: "13.6", resolution: "Liquid Retina", batteryCondition: "Excellent, cycle count shown per unit", ports: "2x Thunderbolt, MagSafe 3, headphone jack", weight: "1.24 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Fanless and silent", "Up to 18 hours of battery", "MagSafe charging"], description: "Thin, silent and fast, with all-day battery.",
    variants: [v("MBA-M2-8-256-U", { ram: "8GB", storage: "256GB SSD", colour: "Midnight", condition: UK }, 850000, 5, { comparePrice: 920000 }), v("MBA-M2-16-512-U", { ram: "16GB", storage: "512GB SSD", colour: "Starlight", condition: UK }, 1050000, 2), v("MBA-M2-8-256-N", { ram: "8GB", storage: "256GB SSD", colour: "Midnight", condition: NEW }, 1250000, 3)] },
  { name: "MacBook Air 13-inch M1", brand: "Apple", cat: "macbooks", series: "MacBook Air", model: "M1 2020", kind: "macbook", color: "Space Gray", bestseller: true, onOffer: true,
    specs: { processor: "Apple M1", graphics: "7-core GPU", os: "macOS", screenSize: "13.3", resolution: "Retina", batteryCondition: "Good, cycle count shown per unit", ports: "2x Thunderbolt / USB 4, headphone jack", weight: "1.29 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Still fast for everyday work", "Great battery"], description: "The laptop that started Apple silicon, and still a great buy.",
    variants: [v("MBA-M1-8-256-U", { ram: "8GB", storage: "256GB SSD", colour: "Space Gray", condition: UK }, 640000, 8, { comparePrice: 690000 }), v("MBA-M1-8-512-U", { ram: "8GB", storage: "512GB SSD", colour: "Gold", condition: UK }, 720000, 3)] },
  { name: "MacBook Pro 14-inch M3 Pro", brand: "Apple", cat: "macbooks", series: "MacBook Pro", model: "M3 Pro 2023", kind: "macbook", color: "Space Black", featured: true, newArrival: true,
    specs: { processor: "Apple M3 Pro", graphics: "14-core GPU", os: "macOS", screenSize: "14.2", resolution: "Liquid Retina XDR", batteryCondition: "New", ports: "3x Thunderbolt 4, HDMI, SD card, MagSafe 3", weight: "1.61 kg" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Liquid Retina XDR display", "Pro-level performance"], description: "For video editors, developers and designers who need serious power.",
    variants: [v("MBP14-M3P-18-512-N", { ram: "16GB", storage: "512GB SSD", colour: "Space Black", condition: NEW }, 3100000, 2), v("MBP14-M3P-18-1T-N", { ram: "32GB", storage: "1TB SSD", colour: "Silver", condition: NEW }, 3750000, 1)] },

  { name: "iPad 10th Generation", brand: "Apple", cat: "ipads", series: "iPad", model: "10th generation", kind: "tablet", color: "Blue", bestseller: true,
    specs: { chipset: "A14 Bionic", os: "iPadOS", screenSize: "10.9", display: "Liquid Retina", connectivity: "Wi-Fi", camera: "12MP rear, 12MP front", battery: "Up to 10 hours" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Colourful all-screen design", "USB-C"], description: "The everyday iPad for school, streaming and notes.",
    variants: [v("IPAD10-64-BL-N", { storage: "64GB", ram: "4GB", colour: "Blue", condition: NEW }, 520000, 6), v("IPAD10-256-PK-N", { storage: "256GB", ram: "4GB", colour: "Pink", condition: NEW }, 690000, 3)] },
  { name: "iPad Air M2 11-inch", brand: "Apple", cat: "ipads", series: "iPad Air", model: "M2 11-inch", kind: "tablet", color: "Space Gray", featured: true,
    specs: { chipset: "Apple M2", os: "iPadOS", screenSize: "11", display: "Liquid Retina", connectivity: "Wi-Fi", camera: "12MP rear, 12MP front", battery: "Up to 10 hours" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["M2 power in a light body", "Apple Pencil Pro support"], description: "Light, powerful and great with Apple Pencil.",
    variants: [v("IPADAIR-M2-128-N", { storage: "128GB", ram: "8GB", colour: "Space Gray", condition: NEW }, 890000, 4), v("IPADAIR-M2-256-UK", { storage: "256GB", ram: "8GB", colour: "Starlight", condition: UK }, 720000, 2)] },
  { name: "iPad Pro 11-inch M4", brand: "Apple", cat: "ipads", series: "iPad Pro", model: "M4 11-inch", kind: "tablet", color: "Space Black", newArrival: true,
    specs: { chipset: "Apple M4", os: "iPadOS", screenSize: "11", display: "Ultra Retina XDR OLED", connectivity: "Wi-Fi + Cellular", camera: "12MP rear, 12MP front", battery: "Up to 10 hours" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Ultra Retina XDR OLED", "Thin and light"], description: "The most capable iPad ever, with an OLED display.",
    variants: [v("IPADPRO-M4-256-N", { storage: "256GB", ram: "8GB", colour: "Space Black", condition: NEW }, 1650000, 2)] },
  { name: "iPad mini 6", brand: "Apple", cat: "ipads", series: "iPad mini", model: "6th generation", kind: "tablet", color: "Starlight",
    specs: { chipset: "A15 Bionic", os: "iPadOS", screenSize: "8.3", display: "Liquid Retina", connectivity: "Wi-Fi", camera: "12MP rear, 12MP front", battery: "Up to 10 hours" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Pocketable", "Apple Pencil 2 support"], description: "Small enough for one hand, powerful enough for anything.",
    variants: [v("IPADMINI6-64-SL-U", { storage: "64GB", ram: "4GB", colour: "Starlight", condition: UK }, 380000, 4)] },
  { name: "Samsung Galaxy Tab S9", brand: "Samsung", cat: "tablets", series: "Galaxy Tab S", model: "Tab S9", kind: "tablet", color: "Graphite", featured: true,
    specs: { chipset: "Snapdragon 8 Gen 2", os: "Android 13", screenSize: "11", display: "Dynamic AMOLED 2X, 120Hz", connectivity: "Wi-Fi", camera: "13MP + 8MP rear, 12MP front", battery: "8400mAh" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["S Pen included", "IP68 water resistant"], description: "A flagship Android tablet with a brilliant AMOLED display and S Pen in the box.",
    variants: [v("TABS9-128-GR-N", { storage: "128GB", ram: "8GB", colour: "Graphite", condition: NEW }, 940000, 3, { comparePrice: 990000 }), v("TABS9-256-BG-N", { storage: "256GB", ram: "12GB", colour: "Gold", condition: NEW }, 1100000, 2)] },
  { name: "Samsung Galaxy Tab A9+", brand: "Samsung", cat: "tablets", series: "Galaxy Tab A", model: "Tab A9+", kind: "tablet", color: "Grey", bestseller: true,
    specs: { chipset: "Snapdragon 695", os: "Android 13", screenSize: "11", display: "LCD, 90Hz", connectivity: "Wi-Fi + Cellular", camera: "8MP rear, 5MP front", battery: "7040mAh" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Big screen on a budget", "Quad speakers"], description: "A big, smooth screen for movies, learning and everyday use.",
    variants: [v("TABA9P-64-GY-N", { storage: "64GB", ram: "4GB", colour: "Grey", condition: NEW }, 285000, 10), v("TABA9P-128-GY-N", { storage: "128GB", ram: "8GB", colour: "Grey", condition: NEW }, 340000, 6)] },
  { name: "Kids Learning Tablet 8-inch", brand: "Generic", cat: "kids-tablets", series: "Kids", model: "Learn 8", kind: "kids", color: "Orange", featured: true, onOffer: true,
    specs: { ageRange: "3 to 10 years", parentalControls: "Parent profile with app and time limits", protectiveCase: "Shock-proof bumper case included", screenSize: "8", os: "Android (kid-safe launcher)", battery: "Up to 8 hours" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Shock-proof bumper", "Parental controls", "Learning apps pre-loaded"], description: "A tough tablet made for little hands, with parental controls and a protective case.",
    variants: [v("KIDS8-32-OR-N", { storage: "32GB", colour: "Orange", condition: NEW }, 95000, 14, { comparePrice: 110000 }), v("KIDS8-32-BL-N", { storage: "32GB", colour: "Blue", condition: NEW }, 95000, 9)] },
  { name: "Kids Entertainment Tablet 10-inch", brand: "Generic", cat: "kids-tablets", series: "Kids", model: "Play 10", kind: "kids", color: "Blue",
    specs: { ageRange: "5 to 12 years", parentalControls: "Screen-time limits and content filters", protectiveCase: "Silicone bumper included", screenSize: "10", os: "Android", battery: "Up to 9 hours" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Bigger screen for videos and games", "Content filters"], description: "A larger tablet for videos, games and homework, with safeguards parents control.",
    variants: [v("KIDS10-64-BL-N", { storage: "64GB", colour: "Blue", condition: NEW }, 135000, 7)] },

  { name: "Apple 20W USB-C Power Adapter", brand: "Apple", cat: "phone-chargers", series: "Power Adapters", model: "20W", kind: "charger", color: "White", bestseller: true,
    specs: { wattage: 20, connector: "USB-C", compatibleDevices: "iPhone 8 and later, iPad, AirPods", ports: "1x USB-C", material: "Compact wall adapter" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Fast charging for iPhone", "Compact"], description: "Charges iPhone fast with a USB-C to Lightning or USB-C cable (sold separately).",
    variants: [v("APL-20W-N", { colour: "White", condition: "Brand New" }, 28000, 40), v("APL-20W-O", { colour: "White", condition: "Original (Used)" }, 14000, 12)] },
  { name: "Samsung 25W Super Fast Charger", brand: "Samsung", cat: "phone-chargers", series: "Chargers", model: "25W", kind: "charger", color: "Black", bestseller: true,
    specs: { wattage: 25, connector: "USB-C", compatibleDevices: "Galaxy S, A, M and Note series, Galaxy Tab", ports: "1x USB-C", material: "Wall adapter with USB-C cable" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Super Fast Charging", "USB-C cable included"], description: "Original Samsung 25W adapter with cable.",
    variants: [v("SAM-25W-BK", { colour: "Black", condition: "Brand New" }, 17000, 30), v("SAM-25W-WH", { colour: "White", condition: "Brand New" }, 17000, 18)] },
  { name: "USB-C Fast Charger 65W GaN", brand: "Generic", cat: "phone-chargers", series: "Chargers", model: "65W GaN", kind: "charger", color: "Black", featured: true, newArrival: true,
    specs: { wattage: 65, connector: "USB-C", compatibleDevices: "Phones, tablets, MacBook Air, ThinkPad and most USB-C laptops", ports: "1x USB-C", material: "GaN compact build" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Charges laptops and phones", "Compact GaN"], description: "One small charger for your phone, tablet and USB-C laptop.",
    variants: [v("GEN-65W-BK", { colour: "Black", condition: "Brand New" }, 32000, 25)] },
  { name: "Apple 96W USB-C Power Adapter (MacBook Pro)", brand: "Apple", cat: "laptop-chargers", series: "Power Adapters", model: "96W", kind: "laptopCharger", color: "White",
    specs: { wattage: 96, connector: "USB-C", compatibleDevices: "MacBook Pro 14-inch and 16-inch, MacBook Air with USB-C", ports: "1x USB-C", material: "Wall adapter" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Original Apple adapter", "Fast-charges MacBook Pro"], description: "Original Apple 96W adapter for MacBook Pro.",
    variants: [v("APL-96W-N", { colour: "White", condition: "Brand New" }, 78000, 8)] },
  { name: "HP 65W Laptop Charger (Blue Tip)", brand: "HP", cat: "laptop-chargers", series: "Chargers", model: "65W 4.5mm", kind: "laptopCharger", color: "Black",
    specs: { wattage: 65, connector: "4.5mm blue tip", compatibleDevices: "HP EliteBook, ProBook, Pavilion, Envy", ports: "DC output", cableLength: "1.8m" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Fits popular HP models", "Includes power cable"], description: "Replacement HP charger for popular EliteBook, ProBook and Pavilion models.",
    variants: [v("HP-65W-BT", { colour: "Black", condition: "Brand New" }, 22000, 16)] },
  { name: "Dell 65W Laptop Charger (Slim Tip)", brand: "Dell", cat: "laptop-chargers", series: "Chargers", model: "65W 4.5mm", kind: "laptopCharger", color: "Black",
    specs: { wattage: 65, connector: "4.5mm slim tip", compatibleDevices: "Dell Latitude, Inspiron, XPS 13", ports: "DC output", cableLength: "1.8m" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Fits Latitude, Inspiron and XPS 13"], description: "Replacement Dell 65W charger.",
    variants: [v("DELL-65W-ST", { colour: "Black", condition: "Brand New" }, 23000, 4)] },
  { name: "Lenovo 65W USB-C Laptop Charger", brand: "Lenovo", cat: "laptop-chargers", series: "Chargers", model: "65W USB-C", kind: "laptopCharger", color: "Black",
    specs: { wattage: 65, connector: "USB-C", compatibleDevices: "Lenovo ThinkPad, IdeaPad and Yoga with USB-C charging", ports: "USB-C output", cableLength: "1.8m" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["USB-C Power Delivery", "Works with many USB-C laptops"], description: "Original-style Lenovo USB-C charger for modern ThinkPad and IdeaPad laptops.",
    variants: [v("LEN-65W-C", { colour: "Black", condition: "Brand New" }, 26000, 0)] },
  { name: "USB-C to Lightning Cable", brand: "Apple", cat: "cables", series: "Cables", model: "USB-C to Lightning", kind: "cable", color: "White", bestseller: true,
    specs: { wattage: 20, connector: "USB-C to Lightning", compatibleDevices: "iPhone and iPad with Lightning port", cableLength: "1m" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Fast charge with 20W adapter", "Syncs data"], description: "Charge and sync iPhone with a USB-C adapter.",
    variants: [v("APL-C2L-1M", { colour: "White", length: "1m", condition: "Brand New" }, 15000, 35), v("APL-C2L-2M", { colour: "White", length: "2m", condition: "Brand New" }, 21000, 20)] },
  { name: "USB-C to USB-C Charging Cable 100W", brand: "Generic", cat: "cables", series: "Cables", model: "USB-C 100W", kind: "cable", color: "Black",
    specs: { wattage: 100, connector: "USB-C to USB-C", compatibleDevices: "Phones, tablets and USB-C laptops", cableLength: "1.5m", material: "Braided nylon" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Up to 100W", "Braided and durable"], description: "A durable braided cable that handles up to 100W laptop charging.",
    variants: [v("GEN-CC100-1.5", { colour: "Black", length: "1.5m", condition: "Brand New" }, 9500, 50)] },
  { name: "4-Port USB-C and USB-A Charger 100W", brand: "Generic", cat: "multi-port-chargers", series: "Chargers", model: "100W 4-port", kind: "multiport", color: "White", onOffer: true, featured: true,
    specs: { wattage: 100, connector: "2x USB-C + 2x USB-A", compatibleDevices: "Charge a laptop, phone, tablet and earbuds at once", ports: "4 ports", material: "GaN desktop charger" },
    warranty: "Warranty stated on the listing at purchase", highlights: ["Charges four devices at once", "Smart power sharing"], description: "One desktop charger for all your gadgets.",
    variants: [v("GEN-4P100", { colour: "White", condition: "Brand New" }, 58000, 12, { comparePrice: 65000 })] },
];

export async function writeArt(product) {
  const dir = path.join(uploadRoot, "demo");
  await fs.mkdir(dir, { recursive: true });
  const slug = slugify(product.name);
  const colours = [...new Set(product.variants.map((x) => x.attrs.colour).filter(Boolean))];
  const files = [];
  const list = colours.length ? colours.slice(0, 3) : [product.color];
  for (const [i, c] of list.entries()) {
    const name = `${slug}-${slugify(c || "x")}.svg`;
    await fs.writeFile(path.join(dir, name), deviceSvg(product.kind, c || product.color, `${i}`));
    files.push({ url: `/uploads/demo/${name}`, thumb: `/uploads/demo/${name}`, alt: `${product.name} in ${c}` });
  }
  return files;
}

export async function seedTestCatalog() {
  const brands = Object.fromEntries((await Brand.find().lean()).map((b) => [b.name, b]));
  const cats = Object.fromEntries((await Category.find().lean()).map((c) => [c.slug, c]));
  const settings = await getSettings();
  let created = 0;
  for (const d of TEST_PRODUCTS) {
    const slug = slugify(d.name);
    if (await Product.exists({ slug })) continue;
    const images = await writeArt(d);
    const p = new Product({
      name: d.name, slug, brand: brands[d.brand]._id, brandName: d.brand, category: cats[d.cat]._id, categoryName: cats[d.cat].name,
      series: d.series, model: d.model, description: d.description, highlights: d.highlights, specs: d.specs, warranty: d.warranty, network: d.network || "",
      tags: [d.brand, d.series, d.model].filter(Boolean), images, variants: d.variants,
      featured: !!d.featured, bestseller: !!d.bestseller, newArrival: !!d.newArrival, onOffer: !!d.onOffer, lowStockThreshold: settings.shop.lowStockThreshold,
      soldCount: d.bestseller ? 20 + Math.floor(Math.random() * 40) : Math.floor(Math.random() * 15),
    });
    await p.save();
    created++;
  }

  if (!(await Banner.estimatedDocumentCount())) {
    await Banner.create([
      { placement: "hero", title: "Your next phone is here", subtitle: "iPhone 11 to iPhone 17 and Samsung Galaxy S, Z, A and M. Brand new and UK used.", ctaText: "Shop phones", ctaLink: "/category/phones", theme: "blue", sortOrder: 1 },
      { placement: "hero", title: "Laptops that keep up with your work", subtitle: "HP, Dell, Lenovo and MacBook, with specs and battery condition on every listing.", ctaText: "Shop laptops", ctaLink: "/category/laptops", theme: "ink", sortOrder: 2 },
      { placement: "promo", title: "Fast chargers for every device", subtitle: "USB-C, Lightning and laptop chargers", ctaText: "Shop chargers", ctaLink: "/category/chargers-and-accessories", theme: "volt", sortOrder: 1 },
      { placement: "promo", title: "Tablets for the whole family", subtitle: "iPads, Galaxy Tabs and kids' learning tablets", ctaText: "Shop tablets", ctaLink: "/category/tablets", theme: "light", sortOrder: 2 },
    ]);
  }
  if (!(await Coupon.exists({ code: "WELCOME5" }))) {
    await Coupon.create({ code: "WELCOME5", description: "Sample coupon: 5% off, up to ₦25,000", type: "percent", value: 5, maxDiscount: 25000, minSubtotal: 20000, perUserLimit: 1 });
  }
  if (!(await Testimonial.estimatedDocumentCount())) {
    await Testimonial.create([
      { name: "Sample customer", location: "Lagos", text: "Sample testimonial: replace this with a real customer's words from Admin > Testimonials.", rating: 5, sample: true },
      { name: "Sample customer", location: "Abuja", text: "Sample testimonial: ask happy customers if you can feature their feedback here.", rating: 5, sample: true },
      { name: "Sample customer", location: "Port Harcourt", text: "Sample testimonial: delete the samples once you have real feedback.", rating: 5, sample: true },
    ]);
  }
  return created;
}
