import { z } from 'zod';

export const uuid = z.string().uuid('Invalid id');
export const idParam = z.object({ id: uuid });

export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const personName = z.string().trim().min(2, 'Name must be at least 2 characters').max(100);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v));

export const studentProfileFields = z.object({
  rollNumber: optionalText(40),
  department: optionalText(100),
  year: z.coerce.number().int().min(1).max(10).optional().nullable(),
  phone: optionalText(30),
});

export const facultyProfileFields = z.object({
  employeeId: optionalText(40),
  department: optionalText(100),
  designation: optionalText(100),
  phone: optionalText(30),
});

export const searchQuery = z.string().trim().max(100).optional();
