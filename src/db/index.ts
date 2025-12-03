import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import '../utils/env';

const databaseUrl = process.env.DATABASE_URL;

const looksLikePlaceholder = (value?: string) =>
  value?.includes('user:password@host:port/database');

if (!databaseUrl || looksLikePlaceholder(databaseUrl)) {
  throw new Error(
    'DATABASE_URL is missing. Set it to a real Postgres URI, e.g. postgresql://cashucord:cashucord@localhost:5432/cashucord',
  );
}

try {
  new URL(databaseUrl);
} catch (error) {
  throw new Error(
    `DATABASE_URL is not a valid URL (${(error as Error).message}). Use a string like postgresql://user:pass@host:port/dbname`,
  );
}

const client = postgres(databaseUrl);
export const db = drizzle(client, { schema });
