import { config } from 'dotenv';

// Load the test environment before any application module reads process.env.
config({ path: '.env.test', override: true });
process.env.NODE_ENV = 'test';

if (!/test/i.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL in .env.test must point at a dedicated *test* database.');
}
