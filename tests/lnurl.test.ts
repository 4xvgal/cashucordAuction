import { describe, expect, test } from 'bun:test';
import { computeLnurlRange, decodeLnurl, encodeLnurl, resolveLightningAddress } from '../src/utils/lnurl';

describe('lnurl utilities', () => {
  test('round-trips URLs through lnurl encode/decode', () => {
    const original = 'https://example.com/lnurl/callback?user=42';
    const encoded = encodeLnurl(original);
    const decoded = decodeLnurl(encoded);
    expect(decoded).toBe(original);
  });

  test('computes LNURL range boundaries in sats', () => {
    const { minSats, maxSats } = computeLnurlRange(1500, 5500);
    expect(minSats).toBe(2); // ceil(1.5)
    expect(maxSats).toBe(5); // floor(5.5)
  });

  test('resolves lightning address to lnurlp URL', () => {
    const url = resolveLightningAddress('jm@era21.space');
    expect(url).toBe('https://era21.space/.well-known/lnurlp/jm');
  });
});
