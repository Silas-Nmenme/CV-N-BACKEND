import { Router } from "express";
import mongoose from "mongoose";
import { requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, HttpError, paginate, escapeRegex } from "./helpers.js";

/**
 * Small CRUD factory for simple admin resources.
 * options: { permission, schema (zod, used for create+update), sort, search: [fields],
 *            filters: {queryKey: field}, beforeSave(doc, body, req), afterSave, beforeDelete(doc) }
 */
export function crudRouter(Model, options) {
  const { permission, schema, sort = { createdAt: -1 }, search = [], filters = {}, beforeSave, afterSave, beforeDelete, defaultLimit = 50 } = options;
  const router = Router();
  const guard = requirePermission(permission);

  router.get(
    "/",
    guard,
    asyncHandler(async (req, res) => {
      const { page, limit, skip } = paginate(req.query, { defaultLimit, maxLimit: 200 });
      const filter = {};
      if (req.query.q && search.length) {
        const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), "i");
        filter.$or = search.map((f) => ({ [f]: rx }));
      }
      for (const [qk, field] of Object.entries(filters)) {
        if (req.query[qk] !== undefined && req.query[qk] !== "") {
          const v = req.query[qk];
          filter[field] = v === "true" ? true : v === "false" ? false : v;
        }
      }
      const [items, total] = await Promise.all([Model.find(filter).sort(sort).skip(skip).limit(limit).lean(), Model.countDocuments(filter)]);
      res.json({ success: true, items, total, page, pages: Math.ceil(total / limit) });
    })
  );

  router.get(
    "/:id",
    guard,
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
      const doc = await Model.findById(req.params.id).lean();
      if (!doc) throw new HttpError(404, "Not found.");
      res.json({ success: true, item: doc });
    })
  );

  router.post(
    "/",
    guard,
    validate({ body: schema }),
    asyncHandler(async (req, res) => {
      const doc = new Model(req.body);
      if (beforeSave) await beforeSave(doc, req.body, req, true);
      await doc.save();
      if (afterSave) await afterSave(doc, req, true);
      res.status(201).json({ success: true, item: doc });
    })
  );

  router.put(
    "/:id",
    guard,
    validate({ body: schema }),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
      const doc = await Model.findById(req.params.id);
      if (!doc) throw new HttpError(404, "Not found.");
      doc.set(req.body);
      if (beforeSave) await beforeSave(doc, req.body, req, false);
      await doc.save();
      if (afterSave) await afterSave(doc, req, false);
      res.json({ success: true, item: doc });
    })
  );

  router.delete(
    "/:id",
    guard,
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id.");
      const doc = await Model.findById(req.params.id);
      if (!doc) throw new HttpError(404, "Not found.");
      if (beforeDelete) await beforeDelete(doc);
      await doc.deleteOne();
      res.json({ success: true });
    })
  );

  return router;
}
