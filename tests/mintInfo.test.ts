import { expect, test } from 'bun:test';

const mintUrl = process.env.MINT_URL ?? 'http://localhost:3338';

test('mint info responds for configured mint', async () => {
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
});
