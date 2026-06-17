import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Body-validation middleware. Parses `req.body` against a Zod schema and, on
 * success, replaces it with the parsed result so handlers receive clean,
 * coerced data (unknown keys are stripped). On failure it returns a single,
 * consistent 400 — this is the ONE place a ZodError becomes an HTTP response,
 * so individual routes/controllers no longer reimplement that handling.
 *
 * Usage:  router.post('/', validate(someSchema), handler)
 */
export const validate =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    // Hand the parsed (trimmed/coerced/defaulted) data to the handler.
    req.body = result.data;
    next();
  };

export default validate;
