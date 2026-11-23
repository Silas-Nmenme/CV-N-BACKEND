import { ZodError } from "zod";
import { HttpError } from "../utils/helpers.js";

/** validate({ body: schema, query: schema, params: schema }) */
export const validate = (schemas) => (req, _res, next) => {
  try {
    for (const part of ["params", "query", "body"]) {
      if (schemas[part]) {
        const parsed = schemas[part].parse(req[part] ?? {});
        if (part === "query") {
          Object.defineProperty(req, "validatedQuery", { value: parsed, configurable: true });
        } else {
          req[part] = parsed;
        }
      }
    }
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const fields = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "_";
        if (!fields[key]) fields[key] = issue.message;
      }
      const first = err.issues[0];
      return next(new HttpError(400, first?.message || "Please check the form and try again.", fields));
    }
    next(err);
  }
};
