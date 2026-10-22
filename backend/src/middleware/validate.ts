import type { NextFunction, Request, Response } from 'express';
import type { z, ZodTypeAny } from 'zod';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export type Validated<S extends Schemas> = {
  [K in keyof S]: S[K] extends ZodTypeAny ? z.output<S[K]> : never;
};

/**
 * Validates and normalises params, query and body before the handler runs. Unknown body keys are
 * stripped by Zod, which also guards against mass assignment of sensitive fields (role, status, marks…).
 * Read the typed result with `getValidated(res, schemas)`.
 */
export function validateRequest<S extends Schemas>(schemas: S) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const out: Record<string, unknown> = {};
      if (schemas.params) out.params = schemas.params.parse(req.params);
      if (schemas.query) out.query = schemas.query.parse(req.query);
      if (schemas.body) out.body = schemas.body.parse(req.body ?? {});
      res.locals.validated = out;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function getValidated<S extends Schemas>(res: Response, _schemas: S): Validated<S> {
  return res.locals.validated as Validated<S>;
}
