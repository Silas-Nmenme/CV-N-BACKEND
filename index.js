import express from "express";
import mongoose from "mongoose";
import { createApp } from "./server/app.js";
import { connectDB } from "./server/config/db.js";
import { ensureIndexes } from "./server/scripts/indexes.js";

const app = express();
const api = createApp({ serveFrontend: false });
let databaseReady;

async function initializeDatabase() {
  if (mongoose.connection.readyState === 1) return;
  if (!databaseReady) {
    databaseReady = connectDB()
      .then(() => ensureIndexes())
      .catch((error) => {
        databaseReady = undefined;
        throw error;
      });
  }
  await databaseReady;
}

app.use(async (_req, _res, next) => {
  try {
    await initializeDatabase();
    next();
  } catch (error) {
    next(error);
  }
});
app.use(api);
app.use((error, _req, res, _next) => {
  console.error("[vercel] request initialization failed:", error);
  res.status(503).json({ success: false, message: "Service temporarily unavailable." });
});

export default app;
