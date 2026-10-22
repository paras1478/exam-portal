import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

function layout(title: string, body: string, cta?: { label: string; href: string }) {
  const button = cta
    ? `<a href="${cta.href}" style="display:inline-block;margin-top:20px;padding:10px 18px;border-radius:10px;background:linear-gradient(90deg,#4F8CFF,#8B5CF6);color:#fff;text-decoration:none">${escapeHtml(cta.label)}</a>`
    : '';
  return `<div style="font-family:Inter,Arial,sans-serif;background:#0B1020;padding:32px;color:#e2e8f0">
  <div style="max-width:560px;margin:auto;background:#121A2B;border:1px solid #1f2a44;border-radius:16px;padding:28px">
    <h2 style="margin:0 0 12px;color:#fff">${escapeHtml(title)}</h2>
    <div style="line-height:1.6;color:#cbd5e1">${body}</div>
    ${button}
  </div></div>`;
}

/**
 * Sends an email. Never throws: mail failures must not break the user-facing request.
 * Without SMTP configuration the message is logged instead (development fallback).
 */
export async function sendMail(to: string, subject: string, title: string, bodyText: string, cta?: { label: string; path: string }) {
  const href = cta ? new URL(cta.path, env.APP_URL).toString() : undefined;
  const html = layout(title, escapeHtml(bodyText).replace(/\n/g, '<br/>'), cta && href ? { label: cta.label, href } : undefined);
  if (!transport) {
    if (env.NODE_ENV !== 'test') console.info(`[mail:dev] to=${to} subject="${subject}"`);
    return;
  }
  try {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, html, text: `${bodyText}${href ? `\n\n${href}` : ''}` });
  } catch (err) {
    console.error('[mail] failed to send', subject, 'to', to, (err as Error).message);
  }
}

export const mailTemplates = {
  welcome: (to: string, name: string) =>
    sendMail(to, 'Welcome to ExamFlow', `Welcome, ${name}!`, 'Your account has been created. You can now sign in and view your examinations.', {
      label: 'Sign in',
      path: '/login',
    }),
  examScheduled: (to: string, name: string, examTitle: string, startsAt: Date, durationMinutes: number) =>
    sendMail(
      to,
      `Exam scheduled: ${examTitle}`,
      'A new exam has been scheduled',
      `Hi ${name},\n\n"${examTitle}" opens on ${startsAt.toUTCString()} and lasts ${durationMinutes} minutes.`,
      { label: 'View exams', path: '/student/exams' },
    ),
  resultsPublished: (to: string, name: string, examTitle: string) =>
    sendMail(to, `Results published: ${examTitle}`, 'Your result is available', `Hi ${name},\n\nResults for "${examTitle}" have been published.`, {
      label: 'View results',
      path: '/student/results',
    }),
};
