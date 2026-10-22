import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ExamAction, ExamPhase, QuestionType, Role } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export const formatDateTime = (d: string | Date | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : '—');
export const formatDate = (d: string | Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : '—');

export function formatRelative(d: string | Date, now = Date.now()) {
  const diff = new Date(d).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return diff >= 0 ? 'in a moment' : 'just now';
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const formatMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`);

export const formatScore = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');

export const formatPercent = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export const roleHome: Record<Role, string> = { STUDENT: '/student', FACULTY: '/faculty', ADMIN: '/admin' };

export const questionTypeLabel: Record<QuestionType, string> = {
  MCQ: 'Single choice',
  MULTI_SELECT: 'Multiple select',
  TRUE_FALSE: 'True / False',
  DESCRIPTIVE: 'Descriptive',
};

export const phaseLabel: Record<ExamPhase, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SCHEDULED: 'Upcoming',
  LIVE: 'Live',
  ENDED: 'Ended',
  CANCELLED: 'Cancelled',
  ARCHIVED: 'Archived',
};

export const examActionLabel: Record<ExamAction, string> = {
  SUBMIT: 'Submit for approval',
  WITHDRAW: 'Withdraw',
  APPROVE: 'Approve',
  REJECT: 'Reject',
  PUBLISH: 'Publish',
  UNPUBLISH: 'Unpublish',
  CANCEL: 'Cancel exam',
  ARCHIVE: 'Archive',
  RESTORE: 'Restore',
};

/** Converts an ISO string to the value format of <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | Date) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export const fromLocalInput = (v: string) => new Date(v).toISOString();

/** First name for greetings, skipping honorifics such as "Dr." or "Prof.". */
export function firstName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.find((p) => !/^(dr|prof|mr|mrs|ms|mx)\.?$/i.test(p)) ?? parts[0] ?? '';
}
