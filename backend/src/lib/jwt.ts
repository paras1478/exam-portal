import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface TokenPayload {
  sub: string;
  /** Must equal User.tokenVersion; bumping the column revokes all existing tokens. */
  ver: number;
}

export function signToken(userId: string, tokenVersion: number) {
  return jwt.sign({ sub: userId, ver: tokenVersion } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: Math.round(env.JWT_EXPIRES_IN_HOURS * 3600),
    algorithm: 'HS256',
  });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'object' && typeof decoded.sub === 'string' && typeof decoded.ver === 'number') {
      return { sub: decoded.sub, ver: decoded.ver };
    }
    return null;
  } catch {
    return null;
  }
}
