import type { Request } from 'express';
import type { AuditOutcome, Prisma, Role } from '@prisma/client';
import { prisma } from './prisma.js';

type Db = Prisma.TransactionClient | typeof prisma;

const SENSITIVE_KEY = /pass(word)?|secret|token|hash|authorization|cookie/i;

/** Drops credential-like keys so secrets can never end up in the audit trail. */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !SENSITIVE_KEY.test(k)).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}

/**
 * Appends an audit record (the table is append-only at the database level).
 * The actor's email and role are snapshotted so the trail survives account changes.
 */
export async function audit(
  req: Request | null,
  action: string,
  entityType: string,
  entityId?: string | null,
  metadata?: Prisma.InputJsonValue,
  db: Db = prisma,
  outcome: AuditOutcome = 'SUCCESS',
  actor?: { id: string; email: string; role: Role },
) {
  const who = actor ?? req?.user;
  await db.auditLog.create({
    data: {
      actorId: who?.id ?? null,
      actorEmail: who?.email ?? null,
      actorRole: who?.role ?? null,
      action,
      outcome,
      entityType,
      entityId: entityId ?? null,
      metadata: metadata === undefined ? undefined : (scrub(metadata) as Prisma.InputJsonValue),
      ipAddress: req?.ip ?? null,
    },
  });
}
