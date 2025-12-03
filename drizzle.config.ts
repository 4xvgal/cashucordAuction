import type { Config } from 'drizzle-kit';
import { ensureEnvLoaded } from './src/utils/env';
ensureEnvLoaded();

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const connectionString =
  process.env.DATABASE_URL ??
  process.env.DOCKER_DATABASE_URL ??
  process.env.DRIZZLE_DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL (or DOCKER_DATABASE_URL) must be set for Drizzle config.');
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
} satisfies Config;
