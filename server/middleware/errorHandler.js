import { env } from "../config/env.js";

export function notFound(req, res, next) {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ success: false, message: "That API endpoint does not exist." });
  }
  next();
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.expose ? err.message : "Something went wrong on our side. Please try again.";
  let fields;

  if (err.name === "ValidationError" && err.errors) {
    status = 400;
    fields = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    message = Object.values(fields)[0] || "Validation failed.";
  } else if (err.code === 11000) {
    status = 409;
    const key = Object.keys(err.keyPattern || {})[0] || "value";
    message = `That ${key.replace(/^variants\./, "").replace(/_/g, " ")} is already in use.`;
  } else if (err.name === "CastError") {
    status = 400;
    message = "Invalid identifier supplied.";
  } else if (err.type === "entity.too.large") {
    status = 413;
    message = "The request is too large.";
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed JSON in request.";
  } else if (err.name === "MulterError") {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "Image is too large (max 8 MB)." : "Upload failed.";
  } else if (err.expose && err.details) {
    fields = err.details;
  }

  if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);

  const body = { success: false, message };
  if (fields) body.fields = fields;
  if (err.expose && err.extra) Object.assign(body, err.extra);
  if (!env.isProd && status >= 500) body.debug = String(err.stack || err).split("\n").slice(0, 4);
  res.status(status).json(body);
}
