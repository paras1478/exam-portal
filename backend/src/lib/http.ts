import type { Response } from 'express';

/** Error with an HTTP status whose message is safe to show to API clients. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
  static badRequest(msg: string, details?: unknown) {
    return new ApiError(400, msg, 'BAD_REQUEST', details);
  }
  static unauthorized(msg = 'Authentication required') {
    return new ApiError(401, msg, 'UNAUTHORIZED');
  }
  static forbidden(msg = 'You do not have permission to perform this action') {
    return new ApiError(403, msg, 'FORBIDDEN');
  }
  static notFound(msg = 'Resource not found') {
    return new ApiError(404, msg, 'NOT_FOUND');
  }
  static conflict(msg: string, code = 'CONFLICT') {
    return new ApiError(409, msg, code);
  }
}

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function paginated<T>(res: Response, items: T[], total: number, page: number, pageSize: number) {
  return res.json({
    success: true,
    data: items,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}
