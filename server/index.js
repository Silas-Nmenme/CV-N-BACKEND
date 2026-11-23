import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { createApp } from "./app.js";
import { expireStaleOrders } from "./services/orders.js";
import { ensureIndexes } from "./scripts/indexes.js";

async function main() {
  await connectDB();
  await ensureIndexes();
  const app = createApp();
  const server = app.listen(env.port, () => console.log(`CV GADGETS running on ${env.appUrl} (port ${env.port})`));

  // Release stock held by unpaid orders whose window has passed.
  const timer = setInterval(() => expireStaleOrders().catch((e) => console.error("[sweeper]", e.message)), 60_000);
  timer.unref();

  const shutdown = () => { clearInterval(timer); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 8000).unref(); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
