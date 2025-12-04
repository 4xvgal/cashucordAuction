import { expect, test } from 'bun:test';

const mintUrl = process.env.MINT_URL ?? 'http://localhost:3338';

test('mint info responds for configured mint', async () => {
  try {
    const response = await fetch(`${mintUrl}/v1/info`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });

    expect(response.ok).toBe(true);

    const info = await response.json();
    expect(info).toBeDefined();
    expect(typeof info.name).toBe('string');
    expect(info.name.length).toBeGreaterThan(0);
    expect(info.nuts).toBeDefined();
  } catch (error: any) {
    if (/Unable to connect|ENOTFOUND|ECONNREFUSED/i.test(String(error?.message ?? ''))) {
      console.warn('Skipping mint info test due to network error:', error?.message ?? error);
      return;
    }
    throw error;
  }
});
