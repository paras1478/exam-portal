import type { Role } from '@prisma/client';
import type { SystemSettings } from './settings.js';

/**
 * Permission catalogue. Roles map to permissions in code (reviewable, versioned, testable);
 * a small number of policy permissions are additionally switched by system settings.
 */
export const PERMISSIONS = [
  // administration
  'admin:access',
  'user:read',
  'user:manage',
  'user:delete',
  'role:assign',
  'settings:read',
  'settings:manage',
  'audit:read',
  'report:view',
  'report:export',
  'announcement:send_all',
  'announcement:send_students',
  // examinations
  'exam:create',
  'exam:manage_own',
  'exam:manage_any',
  'exam:submit',
  'exam:approve',
  'exam:publish',
  'exam:cancel',
  'exam:archive',
  // evaluation & results
  'attempt:grade',
  'result:read_own_exams',
  'result:read_all',
  'result:publish',
  'result:correct',
  // students
  'exam:take',
  'result:read_self',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STUDENT: Permission[] = ['exam:take', 'result:read_self'];

const FACULTY: Permission[] = [
  'exam:create',
  'exam:manage_own',
  'exam:submit',
  'exam:publish',
  'exam:archive',
  'attempt:grade',
  'result:read_own_exams',
  'report:export',
  'announcement:send_students',
];

const ADMIN: Permission[] = PERMISSIONS.filter((p) => !STUDENT.includes(p) && p !== 'exam:manage_own');

const BASE: Record<Role, readonly Permission[]> = { STUDENT, FACULTY, ADMIN };

/** Effective permissions for a role under the current policy settings. */
export function permissionsFor(role: Role, settings: Pick<SystemSettings, 'facultyCanPublishResults'>): Set<Permission> {
  const set = new Set<Permission>(BASE[role]);
  if (role === 'FACULTY' && settings.facultyCanPublishResults) set.add('result:publish');
  return set;
}
