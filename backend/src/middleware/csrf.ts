import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env, isProd } from '../config/env.js';
import { ApiError } from '../lib/http.js';

export const CSRF_COOKIE = 'ef_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(res: Response) {
  const token = crypto.randomBytes(32).toString('hex');
  // Readable by the SPA (not httpOnly) so it can echo it back in a header: double-submit pattern.
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    path: '/',
  });
  return token;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Protects cookie-authenticated, state-changing requests:
 *  1. Rejects requests whose Origin header is not an allowed frontend origin.
 *  2. Requires the CSRF header to match the CSRF cookie (double-submit token).
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  if (origin && !env.CORS_ORIGINS.includes(origin)) {
    return next(new ApiError(403, 'Request origin not allowed', 'CSRF_ORIGIN'));
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(new ApiError(403, 'Invalid or missing CSRF token. Refresh the page and try again.', 'CSRF_INVALID'));
  }
  next();
}
