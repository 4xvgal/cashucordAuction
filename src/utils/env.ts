import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

let loaded = false;

export function ensureEnvLoaded(envFile = '.env') {
  if (loaded) return;
  loaded = true;

  try {
    const envPath = resolve(process.cwd(), envFile);
    if (!existsSync(envPath)) {
      return;
    }

    const content = readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const delimiterIndex = trimmed.indexOf('=');
      if (delimiterIndex === -1) continue;

      const key = trimmed.slice(0, delimiterIndex).trim();
      if (!key) continue;

      let value = trimmed.slice(delimiterIndex + 1).trim();

      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn('Unable to load .env file:', error);
  }
}

ensureEnvLoaded();
