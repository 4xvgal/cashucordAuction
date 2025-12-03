import { describe, expect, test } from 'bun:test';
import type { Proof } from '@cashu/cashu-ts';
import { MintQuoteState } from '@cashu/cashu-ts';
import { WalletService } from '../src/services/WalletService';
import { encrypt } from '../src/utils/crypto';
import { createFakeDb } from './helpers/fakeDb';

type WalletOverrideFns = {
  createMintQuoteBolt11?: (amount: number) => Promise<{ request: string; quote: string }>;
  checkMintQuoteBolt11?: (hash: string) => Promise<{ state: MintQuoteState; amount: number; quote: string }>;
  mintProofs?: (amount: number, hash: string) => Promise<Proof[]>;
  receive?: (token: string) => Promise<Proof[]>;
  send?: (amount: number, proofs: Proof[]) => Promise<{ keep?: Proof[]; send: Proof[] }>;
  createMeltQuoteBolt11?: (invoice: string) => Promise<any>;
  meltProofs?: (...args: any[]) => Promise<any>;
};

const createStubWallet = (overrides: WalletOverrideFns = {}) => {
  const calls = {
    createMintQuoteBolt11: [] as number[],
    checkMintQuoteBolt11: [] as string[],
    mintProofs: [] as Array<{ amount: number; hash: string }>,
    receive: [] as string[],
    send: [] as Array<{ amount: number; proofs: Proof[] }>,
  };

  return {
    calls,
    async loadMint() {},
    async createMintQuoteBolt11(amount: number) {
      calls.createMintQuoteBolt11.push(amount);
      if (overrides.createMintQuoteBolt11) {
        return overrides.createMintQuoteBolt11(amount);
      }
      return { request: `invoice-${amount}`, quote: `quote-${amount}` };
    },
    async checkMintQuoteBolt11(hash: string) {
      calls.checkMintQuoteBolt11.push(hash);
      if (overrides.checkMintQuoteBolt11) {
        return overrides.checkMintQuoteBolt11(hash);
      }
      return { state: MintQuoteState.PAID, amount: 0, quote: hash };
    },
    async mintProofs(amount: number, hash: string) {
      calls.mintProofs.push({ amount, hash });
      if (overrides.mintProofs) {
        return overrides.mintProofs(amount, hash);
      }
      return [];
    },
    async receive(token: string) {
      calls.receive.push(token);
      if (overrides.receive) {
        return overrides.receive(token);
      }
      return [];
    },
    async send(amount: number, proofs: Proof[]) {
      calls.send.push({ amount, proofs });
      if (overrides.send) {
        return overrides.send(amount, proofs);
      }
      return { keep: [], send: proofs };
    },
    async createMeltQuoteBolt11(invoice: string) {
      if (overrides.createMeltQuoteBolt11) {
        return overrides.createMeltQuoteBolt11(invoice);
      }
      return { amount: 0, fee_reserve: 0 };
    },
    async meltProofs(...args: any[]) {
      if (overrides.meltProofs) {
        return overrides.meltProofs(...args);
      }
      return { quote: { state: MintQuoteState.PAID, payment_preimage: undefined }, change: [] };
    },
  };
};

describe('WalletService token flows', () => {
  test('createDepositInvoice requests a mint quote via cashu-ts', async () => {
    const wallet = createStubWallet();
    const fakeDb = createFakeDb();
    const service = new WalletService({ mintUrl: 'https://mint.example', wallet: wallet as any, database: fakeDb as any });

    const invoice = await service.createDepositInvoice(123);

    expect(invoice.pr).toBe('invoice-123');
    expect(invoice.hash).toBe('quote-123');
    expect(wallet.calls.createMintQuoteBolt11).toEqual([123]);
  });

  test('confirmDeposit mints proofs and credits the user balance after a paid quote', async () => {
    const mintedProofs: Proof[] = [
      { amount: 100, secret: 'sec-1', C: 'aa', id: 'a1', id_set: '0a' },
      { amount: 20, secret: 'sec-2', C: 'ab', id: 'a2', id_set: '0b' },
    ];
    const wallet = createStubWallet({
      checkMintQuoteBolt11: async () => ({ state: MintQuoteState.PAID, amount: 120, quote: 'hash-1' }),
      mintProofs: async () => mintedProofs,
    });
    const fakeDb = createFakeDb({ users: [{ id: 'user-1', balance: 0n, lockedBalance: 0n }] });
    const service = new WalletService({ mintUrl: 'https://mint.example', wallet: wallet as any, database: fakeDb as any });

    const result = await service.confirmDeposit('user-1', 120, 'hash-1');

    const updatedUser = fakeDb.getUser('user-1');
    expect(result).toBe(true);
    expect(updatedUser?.balance).toBe(120n);
    expect(fakeDb.getProofs().length).toBe(2);
    expect(wallet.calls.checkMintQuoteBolt11).toEqual(['hash-1']);
    expect(wallet.calls.mintProofs).toEqual([{ amount: 120, hash: 'hash-1' }]);
  });

  test('redeemTokenForDeposit swaps incoming tokens into new proofs and credits balance', async () => {
    const incomingProofs: Proof[] = [
      { amount: 50, secret: 'incoming-sec', C: 'aaaa', id: 'aa', id_set: '0a' },
    ];
    const swappedProofs: Proof[] = [
      { amount: 50, secret: 'swapped-sec', C: 'bbbb', id: 'ab', id_set: '0b' },
    ];
    const wallet = createStubWallet({
      receive: async () => incomingProofs,
      send: async () => ({ keep: swappedProofs }),
    });
    const fakeDb = createFakeDb({ users: [{ id: 'user-swap', balance: 0n, lockedBalance: 0n }] });
    const service = new WalletService({
      mintUrl: 'https://mint.example',
      wallet: wallet as any,
      database: fakeDb as any,
      decodeToken: () => ({ mint: 'https://mint.example', proofs: incomingProofs }),
    });

    const { amount } = await service.redeemTokenForDeposit('user-swap', 'mock-token');

    const updatedUser = fakeDb.getUser('user-swap');
    expect(amount).toBe(50);
    expect(updatedUser?.balance).toBe(50n);
    const storedProofs = fakeDb.getProofs();
    expect(storedProofs).toHaveLength(1);
    expect(storedProofs[0].rawProof).toEqual(incomingProofs[0]);
    expect(wallet.calls.receive.length).toBe(1);
    expect(wallet.calls.send.length).toBe(0);
  });

  test('redeemTokenForDeposit still accepts legacy decoded tokens that expose "token" arrays', async () => {
    const incomingProofs: Proof[] = [
      { amount: 5, secret: 'legacy-sec', C: 'cccc', id: 'aa', id_set: '0a' },
    ];
    const wallet = createStubWallet({
      receive: async () => incomingProofs,
      send: async () => ({ keep: incomingProofs }),
    });
    const fakeDb = createFakeDb({ users: [{ id: 'legacy-user', balance: 0n, lockedBalance: 0n }] });
    const service = new WalletService({
      mintUrl: 'https://mint.example',
      wallet: wallet as any,
      database: fakeDb as any,
      decodeToken: () => ({ token: [{ mint: 'https://mint.example', proofs: incomingProofs }] }),
    });

    const { amount } = await service.redeemTokenForDeposit('legacy-user', 'legacy-token');

    const updatedUser = fakeDb.getUser('legacy-user');
    expect(amount).toBe(5);
    expect(updatedUser?.balance).toBe(5n);
  });

  test('redeemTokenForDeposit accepts tokens minted for BOT_MINT_URL alias', async () => {
    const previousAlias = process.env.BOT_MINT_URL;
    process.env.BOT_MINT_URL = 'http://mint:3338';
    const incomingProofs: Proof[] = [
      { amount: 10, secret: 'alias-sec', C: 'cccc', id: 'aa', id_set: '0a' },
    ];
    const swappedProofs: Proof[] = [
      { amount: 10, secret: 'alias-swapped', C: 'dddd', id: 'ab', id_set: '0b' },
    ];
    const wallet = createStubWallet({
      receive: async () => incomingProofs,
      send: async () => ({ keep: swappedProofs }),
    });
    const fakeDb = createFakeDb({ users: [{ id: 'alias-user', balance: 0n, lockedBalance: 0n }] });
    const service = new WalletService({
      mintUrl: 'http://localhost:3338',
      wallet: wallet as any,
      database: fakeDb as any,
      decodeToken: () => ({ mint: 'http://mint:3338', proofs: incomingProofs }),
    });

    try {
      const { amount } = await service.redeemTokenForDeposit('alias-user', 'alias-token');
      expect(amount).toBe(10);
      console.log('alias token re-encoded payload:', wallet.calls.receive);
      expect(wallet.calls.send.length).toBe(0);
      const updatedUser = fakeDb.getUser('alias-user');
      expect(updatedUser?.balance).toBe(10n);
    } finally {
      process.env.BOT_MINT_URL = previousAlias;
    }
  });

  test('createWithdrawalToken selects proofs, calls wallet.send, and debits balance', async () => {
    const initialProofs = [
      {
        id: 1,
        amount: 80,
        secret: encrypt('secret-1'),
        rawProof: { amount: 80, secret: 'secret-1', C: 'cccc', id: 'aa', id_set: '0a' },
        isReserved: false,
        mint_url: 'https://mint.example',
      },
      {
        id: 2,
        amount: 40,
        secret: encrypt('secret-2'),
        rawProof: { amount: 40, secret: 'secret-2', C: 'dddd', id: 'ab', id_set: '0b' },
        isReserved: false,
        mint_url: 'https://mint.example',
      },
    ];
    const wallet = createStubWallet({
      send: async (amount, proofs) => {
        return { keep: [], send: proofs.map((proof) => ({ ...proof, secret: `${proof.secret}-sent` })) };
      },
    });
    const fakeDb = createFakeDb({
      users: [{ id: 'user-withdraw', balance: 150n, lockedBalance: 0n }],
      proofs: initialProofs,
    });
    const service = new WalletService({ mintUrl: 'https://mint.example', wallet: wallet as any, database: fakeDb as any });

    const { token, finalAmount } = await service.createWithdrawalToken('user-withdraw', 100);

    const updatedUser = fakeDb.getUser('user-withdraw');
    expect(updatedUser?.balance).toBe(50n);
    expect(finalAmount).toBe(100);
    expect(typeof token).toBe('string');
    expect(wallet.calls.send[0].amount).toBe(100);
  });
});
