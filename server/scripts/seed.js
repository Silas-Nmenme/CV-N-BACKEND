import { connectDB, disconnectDB } from "../config/db.js";
import { seedBase, seedAdmin } from "./baseData.js";
import { seedDemo } from "./demoData.js";
import { ensureIndexes } from "./indexes.js";

const demo = process.argv.includes("--demo");
await connectDB();
await ensureIndexes();
await seedBase({ demo });
const admin = await seedAdmin();
console.log("Base data ready: categories, brands, delivery zones, pages, settings.");
if (admin) console.log(admin.created ? `Administrator created: ${admin.user.email}` : `Administrator already exists: ${admin.user.email}`);
else console.log("No ADMIN_EMAIL / ADMIN_PASSWORD set: run `npm run create-admin -- <email> <password>` to create the first administrator.");
if (demo) console.log(`Demo catalogue: ${await seedDemo()} sample products added (sample prices; replace with your own).`);
await disconnectDB();
