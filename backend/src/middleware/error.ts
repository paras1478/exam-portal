import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ApiError } from '../lib/http.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route ${req.method} ${req.path} not found`));
}

// Express recognises error handlers by their 4-argument signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let apiErr: ApiError;

  if (err instanceof ApiError) {
    apiErr = err;
  } else if (err instanceof ZodError) {
    apiErr = ApiError.badRequest('Validation failed', err.flatten());
    apiErr.code = 'VALIDATION_ERROR';
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const fields = (err.meta?.target as string[] | undefined) ?? [];
    const message = `A record with this ${fields.join(', ') || 'value'} already exists`;
    apiErr = ApiError.conflict(message, 'DUPLICATE');
    // Lets forms attach the error to the exact field that clashed (e.g. rollNumber vs employeeId).
    if (fields.length) apiErr.details = { fieldErrors: Object.fromEntries(fields.map((f) => [f, [message]])) };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    apiErr = ApiError.notFound();
  } else if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.parse.failed') {
    apiErr = ApiError.badRequest('Malformed JSON body');
  } else if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.too.large') {
    apiErr = new ApiError(413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
  } else {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    apiErr = new ApiError(500, 'Something went wrong. Please try again.', 'INTERNAL_ERROR');
  }

  res.status(apiErr.status).json({
    success: false,
    error: { code: apiErr.code, message: apiErr.message, ...(apiErr.details ? { details: apiErr.details } : {}) },
  });
}
