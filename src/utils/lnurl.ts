import { AppError } from './errors';

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CHARSET_REV: Record<string, number> = {};
for (let i = 0; i < BECH32_CHARSET.length; i += 1) {
  BECH32_CHARSET_REV[BECH32_CHARSET[i]] = i;
}

const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bech32Polymod(values: number[]) {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < GENERATORS.length; i += 1) {
      if ((top >>> i) & 1) {
        chk ^= GENERATORS[i];
      }
    }
  }
  return chk;
}

function hrpExpand(hrp: string) {
  const ret: number[] = [];
  for (const char of hrp) {
    const code = char.charCodeAt(0);
    ret.push(code >>> 5);
  }
  ret.push(0);
  for (const char of hrp) {
    const code = char.charCodeAt(0);
    ret.push(code & 0x1f);
  }
  return ret;
}

function verifyChecksum(hrp: string, data: number[]) {
  return bech32Polymod([...hrpExpand(hrp), ...data]) === 1;
}

function createChecksum(hrp: string, data: number[]) {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ 1;
  const ret: number[] = [];
  for (let p = 0; p < 6; p += 1) {
    ret.push((mod >>> (5 * (5 - p))) & 31);
  }
  return ret;
}

function bech32Decode(input: string) {
  const normalized = input.trim();
  if (normalized.length < 8) {
    throw new AppError('Invalid LNURL: too short.', 'LNURL_FORMAT');
  }
  const lower = normalized.toLowerCase();
  const sep = lower.lastIndexOf('1');
  if (sep < 1 || sep + 7 > lower.length) {
    throw new AppError('Invalid LNURL: separator missing.', 'LNURL_FORMAT');
  }
  const hrp = lower.slice(0, sep);
  const dataPart = lower.slice(sep + 1);
  const data: number[] = [];
  for (const char of dataPart) {
    const value = BECH32_CHARSET_REV[char];
    if (value === undefined) {
      throw new AppError('Invalid LNURL: contains non-bech32 characters.', 'LNURL_FORMAT');
    }
    data.push(value);
  }
  if (!verifyChecksum(hrp, data)) {
    throw new AppError('Invalid LNURL checksum.', 'LNURL_FORMAT');
  }
  return { hrp, words: data.slice(0, -6) };
}

function convertBits(data: number[], from: number, to: number, pad: boolean) {
  let acc = 0;
  let bits = 0;
  const maxV = (1 << to) - 1;
  const result: number[] = [];
  for (const value of data) {
    if (value < 0 || value >> from) {
      throw new AppError('Invalid bech32 word value.', 'LNURL_FORMAT');
    }
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((acc >> bits) & maxV);
    }
  }
  if (pad) {
    if (bits > 0) {
      result.push((acc << (to - bits)) & maxV);
    }
  } else if (bits >= from || ((acc << (to - bits)) & maxV)) {
    throw new AppError('Invalid bech32 padding.', 'LNURL_FORMAT');
  }
  return result;
}

function bech32Encode(hrp: string, words: number[]) {
  const combined = [...words, ...createChecksum(hrp, words)];
  let output = `${hrp}1`;
  for (const value of combined) {
    output += BECH32_CHARSET[value];
  }
  return output;
}

export function decodeLnurl(lnurl: string) {
  if (!lnurl) {
    throw new AppError('LNURL is required.', 'LNURL_FORMAT');
  }
  const { hrp, words } = bech32Decode(lnurl);
  if (!hrp.startsWith('lnurl')) {
    throw new AppError('Invalid LNURL prefix.', 'LNURL_FORMAT');
  }
  const bytes = convertBits(words, 5, 8, false);
  return textDecoder.decode(Uint8Array.from(bytes));
}

export function encodeLnurl(url: string) {
  const bytes = Array.from(textEncoder.encode(url));
  const words = convertBits(bytes, 8, 5, true);
  return bech32Encode('lnurl', words);
}

export function resolveLightningAddress(address: string) {
  const trimmed = address.trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(trimmed)) {
    throw new AppError('Invalid lightning address.', 'LNURL_FORMAT');
  }
  const [nameRaw, domainRaw] = trimmed.split('@');
  const name = encodeURIComponent(nameRaw.toLowerCase());
  const domain = domainRaw.toLowerCase();
  const protocol = domain === 'localhost' || domain.startsWith('localhost:')
    ? 'http'
    : 'https';
  return `${protocol}://${domain}/.well-known/lnurlp/${name}`;
}

export function computeLnurlRange(minSendableMsat: number, maxSendableMsat: number) {
  if (!Number.isFinite(minSendableMsat) || !Number.isFinite(maxSendableMsat)) {
    throw new AppError('LNURL provided invalid sendable amounts.', 'LNURL_FORMAT');
  }
  if (minSendableMsat <= 0 || maxSendableMsat <= 0 || maxSendableMsat < minSendableMsat) {
    throw new AppError('LNURL sendable range is invalid.', 'LNURL_FORMAT');
  }
  const minSats = Math.ceil(minSendableMsat / 1000);
  const maxSats = Math.floor(maxSendableMsat / 1000);
  return { minSats, maxSats };
}
