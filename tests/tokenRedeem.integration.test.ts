import { Wallet } from '@cashu/cashu-ts';
import { expect, test } from 'bun:test';
import { WalletService } from '../src/services/WalletService';
import { createFakeDb } from './helpers/fakeDb';

const integrationToken = process.env.CASHU_TEST_TOKEN;
const integrationMintUrl = process.env.CASHU_TEST_MINT_URL ?? process.env.MINT_URL ?? 'http://localhost:3338';
const integrationTokenMint = process.env.CASHU_TEST_TOKEN_MINT_URL ?? process.env.BOT_MINT_URL;

const shouldRunIntegration = integrationToken && process.env.CASHU_RUN_INTEGRATION === 'true';
const maybeTest = shouldRunIntegration ? test : test.skip;

maybeTest('redeems a provided Cashu token against the configured mint', async () => {
  const previousAlias = process.env.BOT_MINT_URL;
  if (integrationTokenMint) {
    process.env.BOT_MINT_URL = integrationTokenMint;
  }
  try {
    const wallet = new Wallet(integrationMintUrl);
    const fakeDb = createFakeDb({
      users: [{ id: 'integration-user', balance: 0n, lockedBalance: 0n }],
    });

    const service = new WalletService({
      mintUrl: integrationMintUrl,
      wallet,
      database: fakeDb as any,
    });

    const { amount } = await service.redeemTokenForDeposit('integration-user', integrationToken!);

    expect(amount).toBeGreaterThan(0);
    const updated = fakeDb.getUser('integration-user');
    expect(updated?.balance ?? 0n).toBe(BigInt(amount));
  } finally {
    process.env.BOT_MINT_URL = previousAlias;
  }
});
