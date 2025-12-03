import { expect, test } from 'bun:test';

const localMintUrl = process.env.LOCAL_MINT_URL ?? 'http://localhost:3338';

const mintEndpoints = [
  { url: localMintUrl, label: 'Local Nutshell mint' },
 
];
for (const mint of mintEndpoints) {
  test(`mint info responds for ${mint.label}`, async () => {
    const response = await fetch(`${mint.url}/v1/info`, {
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
}
