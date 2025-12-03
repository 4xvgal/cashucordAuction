import * as crypto from 'crypto';
import './env';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

if (!ENCRYPTION_KEY || Buffer.from(ENCRYPTION_KEY, 'hex').length !== 32) {
  throw new Error('ENCRYPTION_KEY must be a 32-byte hex string.');
}

const key = Buffer.from(ENCRYPTION_KEY, 'hex');

/**
 * Encrypts a plaintext string.
 * @param text The plaintext to encrypt.
 * @returns The encrypted string in format 'iv:encrypted:tag'.
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * Decrypts an encrypted string.
 * @param encryptedText The encrypted text in format 'iv:encrypted:tag'.
 * @returns The decrypted plaintext.
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format.');
  }
  const [ivHex, encryptedHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([decipher.update(encrypted, 'utf8'), decipher.final()]);
  return decrypted.toString();
}
