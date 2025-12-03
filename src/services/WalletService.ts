import {
  Wallet,
  getDecodedToken,
  Proof,
  MintQuoteState,
  MeltQuoteState,
  getEncodedTokenV4,
} from '@cashu/cashu-ts';
import { db } from '../db';
import { proofs as proofsTable, users as usersTable } from '../db/schema';
import { encrypt, decrypt } from '../utils/crypto';
import { eq, and, inArray } from 'drizzle-orm';
import { AppError } from '../utils/errors';

class WalletService {
  private wallet: Wallet;
  private ready: Promise<void>;
  private mintUrl: string;

  constructor() {
    if (!process.env.MINT_URL) {
      throw new AppError('MINT_URL is not set in .env file', 'CONFIGURATION');
    }
    this.mintUrl = process.env.MINT_URL;
    this.wallet = new Wallet(this.mintUrl);
    this.ready = this.wallet.loadMint();
  }

  private async ensureReady() {
    await this.ready;
  }

  /**
   * Creates a Lightning invoice for a user to deposit funds.
   * @param amount The amount in satoshis.
   * @returns The invoice and the hash to check for payment.
   */
  async createDepositInvoice(amount: number): Promise<{ pr: string, hash: string }> {
    await this.ensureReady();
    const quote = await this.wallet.createMintQuoteBolt11(amount);
    return { pr: quote.request, hash: quote.quote };
  }

  /**
   * Checks if a deposit invoice has been paid and updates the user's balance.
   * This should be called after a user is believed to have paid the invoice.
   * @param userId The Discord user ID.
   * @param amount The amount of the invoice.
   * @param hash The hash of the invoice.
   * @returns A boolean indicating if the deposit was successful.
   */
  async confirmDeposit(userId: string, amount: number, hash: string): Promise<boolean> {
    await this.ensureReady();
    try {
      const quote = await this.wallet.checkMintQuoteBolt11(hash);
      if (!quote || quote.state !== MintQuoteState.PAID) {
        return false;
      }
      const mintAmount = quote.amount ?? amount;
      const proofs = await this.wallet.mintProofs(mintAmount, hash);
      
      await db.transaction(async (tx) => {
        // Create user if not exists
        await tx.insert(usersTable)
          .values({ id: userId, balance: 0n, lockedBalance: 0n })
          .onConflictDoNothing();

        // Add new proofs to the treasury
        const newProofs = proofs.map(p => ({
          amount: p.amount,
          secret: encrypt(p.secret),
          C: p.C,
          id_set: p.id,
          mint_url: this.mintUrl,
          rawProof: p,
        }));
        await tx.insert(proofsTable).values(newProofs);

        // Update user's balance
        const currentUser = await tx.query.users.findFirst({ where: eq(usersTable.id, userId), for: 'update' });
        const currentBalance = currentUser?.balance ?? 0n;
        await tx.update(usersTable)
          .set({ balance: currentBalance + BigInt(mintAmount) })
          .where(eq(usersTable.id, userId));
      });

      return true;
    } catch (error) {
      console.error('Deposit confirmation failed:', error);
      return false;
    }
  }

  /**
   * Redeems a Cashu token provided by a user and adds the funds to their balance.
   * This performs a swap to ensure the bot holds a new, unique proof.
   * @param userId The Discord user ID.
   * @param encodedToken The Cashu token string (cashuA...).
   */
  async redeemTokenForDeposit(userId: string, encodedToken: string): Promise<{ amount: number }> {
    await this.ensureReady();
    const decodedToken = getDecodedToken(encodedToken);
    const tokenAmount = decodedToken.token.reduce((total, { proofs }) => total + proofs.reduce((sum, p) => sum + p.amount, 0), 0);

    // The "swap" is essentially receiving the token and immediately creating a new one for the same amount.
    // This invalidates the proofs the user sent.
    // 1. Receive the token to get its proofs into the wallet's memory.
    const receivedProofs = await this.wallet.receive(encodedToken);
    
    const { keep: newProofsForBot = [] } = await this.wallet.send(tokenAmount, receivedProofs);

    await db.transaction(async (tx) => {
      // Create user if not exists
      await tx.insert(usersTable)
        .values({ id: userId, balance: 0n, lockedBalance: 0n })
        .onConflictDoNothing();

      // Add new proofs to the treasury
      const newProofs = newProofsForBot.map(p => ({
        amount: p.amount,
        secret: encrypt(p.secret),
        C: p.C,
        id_set: p.id,
        mint_url: this.mintUrl,
        rawProof: p,
      }));
      await tx.insert(proofsTable).values(newProofs);

      // Update user's balance
      const currentUser = await tx.query.users.findFirst({ where: eq(usersTable.id, userId), for: 'update' });
      const currentBalance = currentUser?.balance ?? 0n;
      await tx.update(usersTable)
          .set({ balance: currentBalance + BigInt(tokenAmount) })
          .where(eq(usersTable.id, userId));
    });

    return { amount: tokenAmount };
  }

  /**
   * Creates a Cashu token for a user to withdraw funds.
   * @param userId The Discord user ID.
   * @param amount The amount to withdraw in satoshis.
   * @returns The encoded Cashu token.
   */
  async createWithdrawalToken(userId: string, amount: number): Promise<{ token: string, finalAmount: number }> {
    await this.ensureReady();
    const bigIntAmount = BigInt(amount);
    
    const result = await db.transaction(async (tx) => {
      // 1. Lock user row and check balance
      const user = await tx.query.users.findFirst({ where: eq(usersTable.id, userId), for: 'update' });
      if (!user || user.balance < bigIntAmount) {
        throw new AppError('Insufficient balance.', 'INSUFFICIENT_FUNDS');
      }

      // 2. Select proofs from treasury
      const { selectedProofs, proofsToUpdate, proofsAmount } = await this._selectProofsForAmount(tx, amount);
      const finalAmount = proofsAmount > amount ? amount : proofsAmount;
      const bigIntFinalAmount = BigInt(finalAmount);


      // 3. Decrypt secrets and prepare for wallet operation
      const proofsForSending: Proof[] = selectedProofs.map(p => ({
        ...p.rawProof as Proof,
        secret: decrypt(p.secret),
      }));
      
      // 4. Perform the send operation to split proofs
      const { keep = [], send } = await this.wallet.send(finalAmount, proofsForSending);
      const encodedToken = getEncodedTokenV4({ mint: this.mintUrl, proofs: send });

      // 5. Update database
      // Delete used proofs
      await tx.delete(proofsTable).where(inArray(proofsTable.id, proofsToUpdate.map(p => p.id)));

      // Insert change proofs
      if (keep.length > 0) {
        const newChangeProofs = keep.map(p => ({
          amount: p.amount,
          secret: encrypt(p.secret),
          C: p.C,
          id_set: p.id,
          mint_url: this.mintUrl,
          rawProof: p,
        }));
        await tx.insert(proofsTable).values(newChangeProofs);
      }

      // Update user balance
      await tx.update(usersTable)
        .set({ balance: user.balance - bigIntFinalAmount })
        .where(eq(usersTable.id, userId));
      
      return { token: encodedToken, finalAmount };
    });

    return result;
  }

    /**
   * Pays a Lightning invoice for a user.
   * @param userId The Discord user ID.
   * @param invoice The LN invoice to pay.
   * @returns The result of the payment.
   */
  async payLightningInvoice(userId: string, invoice: string): Promise<{ isPaid: boolean, preimage: string | undefined, change: Proof[] }> {
    await this.ensureReady();

    const result = await db.transaction(async (tx) => {
        const user = await tx.query.users.findFirst({ where: eq(usersTable.id, userId), for: 'update' });
        const meltQuote = await this.wallet.createMeltQuoteBolt11(invoice);
        const amountToSend = meltQuote.amount + meltQuote.fee_reserve;
        const bigIntAmountToSend = BigInt(amountToSend);

        if (!user || user.balance < bigIntAmountToSend) {
            throw new AppError('Insufficient balance.', 'INSUFFICIENT_FUNDS');
        }

        const { selectedProofs, proofsToUpdate } = await this._selectProofsForAmount(tx, amountToSend);

        const proofsForMelting: Proof[] = selectedProofs.map(p => ({
            ...p.rawProof as Proof,
            secret: decrypt(p.secret),
        }));
        
        const { keep = [], send } = await this.wallet.send(amountToSend, proofsForMelting, { includeFees: true });
        const meltResponse = await this.wallet.meltProofs(meltQuote, send);
        const isPaid = meltResponse.quote.state === MeltQuoteState.PAID;
        const preimage = meltResponse.quote.payment_preimage ?? undefined;
        const meltedChange = [...keep, ...meltResponse.change];

        if (isPaid) {
            await tx.delete(proofsTable).where(inArray(proofsTable.id, proofsToUpdate.map(p => p.id)));

            if (meltedChange.length > 0) {
                const newChangeProofs = meltedChange.map(p => ({
                    amount: p.amount,
                    secret: encrypt(p.secret),
                    C: p.C,
                    id_set: p.id,
                    mint_url: this.mintUrl,
                    rawProof: p,
                }));
                await tx.insert(proofsTable).values(newChangeProofs);
            }
            const changeAmount = meltedChange.reduce((sum, proof) => sum + BigInt(proof.amount), 0n);
            const netSpent = bigIntAmountToSend - changeAmount;
            await tx.update(usersTable)
                .set({ balance: user.balance - netSpent })
                .where(eq(usersTable.id, userId));
        } else {
            // If payment fails, release the reserved proofs
            await tx.update(proofsTable).set({ isReserved: false }).where(inArray(proofsTable.id, proofsToUpdate.map(p => p.id)));
        }

        return { isPaid, preimage, change: meltedChange };
    });

    return result;
  }

  /**
   * Selects a set of proofs that sum to at least the target amount.
   * This is a helper for withdrawal methods. It marks the selected proofs as reserved.
   * @param tx The Drizzle transaction instance.
   * @param amount The target amount in satoshis.
   * @private
   */
  private async _selectProofsForAmount(tx: any, amount: number) {
    const allProofs = await tx.query.proofs.findMany({
      where: and(eq(proofsTable.isReserved, false)),
      orderBy: (proofs, { asc }) => [asc(proofs.amount)],
    });

    let sum = 0;
    const selectedProofs: typeof allProofs = [];
    for (const proof of allProofs) {
      if (sum >= amount) break;
      selectedProofs.push(proof);
      sum += proof.amount;
    }

    if (sum < amount) {
      throw new AppError('Insufficient treasury balance.', 'TREASURY_SHORTFALL');
    }
    
    const proofsToUpdate = selectedProofs.map(p => ({ id: p.id }));
    if (proofsToUpdate.length > 0) {
        await tx.update(proofsTable)
            .set({ isReserved: true })
            .where(inArray(proofsTable.id, proofsToUpdate.map(p => p.id)));
    }


    return { selectedProofs, proofsToUpdate, proofsAmount: sum };
  }
}

export const walletService = new WalletService();
