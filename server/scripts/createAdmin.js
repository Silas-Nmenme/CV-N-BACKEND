import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { seedAdmin } from "./baseData.js";
import { passwordRule } from "../routes/auth.js";

const [email, password, name] = [process.argv[2] || env.adminEmail, process.argv[3] || env.adminPassword, process.argv[4] || env.adminName];
if (!email || !password) {
  console.error("Usage: npm run create-admin -- <email> <password> [name]\n   or set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  process.exit(1);
}
const check = passwordRule.safeParse(password);
if (!check.success) {
  console.error(check.error.issues[0].message);
  process.exit(1);
}
await connectDB();
const r = await seedAdmin(email.toLowerCase(), password, name);
console.log(r.created ? `Administrator created: ${email}` : `An account for ${email} already exists (not changed).`);
await disconnectDB();
