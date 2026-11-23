// Starts the app with a stub payment gateway for manual / browser end-to-end testing.
import { startGatewayStub } from "./helpers.js";
import http from "node:http";
const gw = await startGatewayStub();
Object.assign(process.env, {
  NODE_ENV: "development", PORT: "3100", APP_URL: "http://localhost:3100", MONGO_URI: "mongodb://127.0.0.1:27017/cvg_e2e", JWT_SECRET: "e2e-secret-0123456789-0123456789-abc",
  DISABLE_RATE_LIMIT: "1", UPLOAD_DIR: "/tmp/cvg-e2e-uploads", PAYSTACK_SECRET_KEY: "sk_test_secret", PAYSTACK_BASE_URL: gw.url, FLW_SECRET_KEY: "FLWSECK_TEST", FLW_SECRET_HASH: "flw-hash-123", FLW_BASE_URL: gw.url,
});
const mongoose = (await import("mongoose")).default;
const { connectDB } = await import("../server/config/db.js");
await connectDB();
await mongoose.connection.dropDatabase();
const { ensureIndexes } = await import("../server/scripts/indexes.js");
await ensureIndexes();
const { seedBase, seedAdmin } = await import("../server/scripts/baseData.js");
const { seedDemo } = await import("../server/scripts/demoData.js");
await seedBase({ demo: true }); await seedDemo(); await seedAdmin("owner@test.ng", "Owner12345", "Owner");
const { Setting } = await import("../server/models/Misc.js");
await Setting.updateOne({ key: "main" }, { $set: { "store.whatsapp": "2348031234567", "store.phone": "0803 123 4567", "store.email": "shop@example.ng", "store.address": "Sample address, Lagos", "payments.bankTransfer": true, "payments.bankName": "Test Bank", "payments.accountName": "CV GADGETS", "payments.accountNumber": "0123456789" } });
const { createApp } = await import("../server/app.js");
http.createServer(createApp()).listen(3100, () => console.log("e2e app on 3100, gateway on", gw.url));
export const stub = gw;
