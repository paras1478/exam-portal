import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

/**
 * System settings: every key, its type and its default live here. The database only stores overrides,
 * so unknown keys can never be written and a fresh install behaves predictably.
 */
export const settingsSchema = z.object({
  /** Faculty must submit exams for admin approval before they can be published. */
  requireExamApproval: z.boolean(),
  /** Faculty may publish results of their own exams (otherwise only administrators can). */
  facultyCanPublishResults: z.boolean(),
  /** Public student self-registration is open. */
  allowStudentRegistration: z.boolean(),
  institutionName: z.string().trim().min(2, 'Institution name must be at least 2 characters').max(100),
  supportEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email address')]),
});

export type SystemSettings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof SystemSettings;

export const DEFAULT_SETTINGS: SystemSettings = {
  requireExamApproval: true,
  facultyCanPublishResults: false,
  allowStudentRegistration: true,
  institutionName: 'ExamFlow',
  supportEmail: '',
};

/** Settings that unauthenticated visitors may read (login/registration screens). */
export const PUBLIC_SETTING_KEYS = ['institutionName', 'allowStudentRegistration', 'supportEmail'] as const;

const CACHE_MS = 10_000;
let cache: { value: SystemSettings; at: number } | null = null;

export function invalidateSettingsCache() {
  cache = null;
}

export async function getSettings(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<SystemSettings> {
  const useCache = process.env.NODE_ENV !== 'test' && db === prisma;
  if (useCache && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await db.systemSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  // Stored values that no longer satisfy the schema fall back to defaults rather than breaking requests.
  const value = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    const parsed = settingsSchema.shape[key].safeParse(merged[key]);
    if (parsed.success) (value as Record<string, unknown>)[key] = parsed.data;
  }
  if (useCache) cache = { value, at: Date.now() };
  return value;
}

export async function getPublicSettings() {
  const s = await getSettings();
  return Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, s[k]])) as Pick<SystemSettings, (typeof PUBLIC_SETTING_KEYS)[number]>;
}

/** Applies a validated partial update and returns { before, after } for auditing. */
export async function updateSettings(patch: Partial<SystemSettings>, actorId: string, tx: Prisma.TransactionClient) {
  const before = await getSettings(tx);
  for (const [key, value] of Object.entries(patch) as [SettingKey, unknown][]) {
    if (value === undefined) continue;
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, updatedById: actorId },
      update: { value: value as Prisma.InputJsonValue, updatedById: actorId },
    });
  }
  invalidateSettingsCache();
  return { before, after: { ...before, ...patch } as SystemSettings };
}
