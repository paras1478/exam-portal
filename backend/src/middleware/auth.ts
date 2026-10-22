import type { NextFunction, Request, Response } from 'express';
import type { Role, UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/http.js';
import { verifyToken } from '../lib/jwt.js';
import { audit } from '../lib/audit.js';
import { getSettings } from '../services/settings.js';
import { permissionsFor, type Permission } from '../services/permissions.js';

export const SESSION_COOKIE = 'ef_session';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  tokenVersion: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      permissions?: Set<Permission>;
    }
  }
}

/**
 * Verifies the session cookie and loads the user fresh from the database. The token carries only the
 * user id and a token version, so role changes apply immediately and bumping `tokenVersion`
 * (deactivation, role change, password change, deletion) revokes every outstanding session.
 */
export async function authenticateUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next(ApiError.unauthorized());
  const payload = verifyToken(token);
  if (!payload) return next(ApiError.unauthorized('Session expired. Please sign in again.'));

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, role: true, status: true, tokenVersion: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.tokenVersion !== payload.ver) {
    return next(ApiError.unauthorized('Your session is no longer valid. Please sign in again.'));
  }
  if (user.status !== 'ACTIVE') {
    return next(new ApiError(403, `Your account is ${user.status.toLowerCase()}. Contact an administrator.`, 'ACCOUNT_DISABLED'));
  }
  const { deletedAt: _deleted, ...authUser } = user;
  req.user = authUser;
  next();
}

async function deny(req: Request, required: string) {
  // Denials are security-relevant: record them, but never let audit failures mask the 403.
  await audit(req, 'ACCESS_DENIED', 'Route', null, { method: req.method, path: req.originalUrl, required }, undefined, 'DENIED').catch(() => undefined);
  return ApiError.forbidden();
}

export function authorizeRoles(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(await deny(req, `role:${roles.join('|')}`));
    next();
  };
}

export async function loadPermissions(req: Request) {
  if (!req.permissions) req.permissions = permissionsFor(req.user!.role, await getSettings());
  return req.permissions;
}

export async function hasPermission(req: Request, permission: Permission) {
  return (await loadPermissions(req)).has(permission);
}

/** Requires every listed permission, evaluated against the role and the current policy settings. */
export function authorizePermission(...required: Permission[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    const perms = await loadPermissions(req);
    const missing = required.filter((p) => !perms.has(p));
    if (missing.length) return next(await deny(req, missing.join(',')));
    next();
  };
}

/** For checks that depend on the resource (e.g. "publish results" on a specific exam). */
export async function assertPermission(req: Request, permission: Permission) {
  if (!(await hasPermission(req, permission))) throw await deny(req, permission);
}
