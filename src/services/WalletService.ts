import { CashuMint, CashuWallet, getDecodedToken, Proof } from '@cashu/cashu-ts';
import { db } from '../db';
import { proofs as proofsTable, users as usersTable } from '../db/schema';
import { encrypt, decrypt } from '../utils/crypto';
import { eq, and, sum, gte, inArray } from 'drizzle-orm';

class WalletService {
  private wallet: CashuWallet;
  private mint: CashuMint;

  constructor() {
    if (!process.env.MINT_URL) {
      throw new Error('MINT_URL is not set in .env file');
    }
    this.mint = new CashuMint(process.env.MINT_URL);
    this.wallet = new CashuWallet(this.mint);
  }

  /**
   * Creates a Lightning invoice for a user to deposit funds.
   * @param amount The amount in satoshis.
   * @returns The invoice and the hash to check for payment.
   */
  async createDepositInvoice(amount: number): Promise<{ pr: string, hash: string }> {
    const { pr, hash } = await this.wallet.requestMint(amount);
    return { pr, hash };
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
    try {
      const { proofs } = await this.wallet.requestTokens(amount, hash);
      
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
          mint_url: this.mint.mintUrl,
          rawProof: p,
        }));
        await tx.insert(proofsTable).values(newProofs);

        // Update user's balance
        const currentUser = await tx.query.users.findFirst({ where: eq(usersTable.id, userId), for: 'update' });
        const currentBalance = currentUser?.balance ?? 0n;
        await tx.update(usersTable)
          .set({ balance: currentBalance + BigInt(amount) })
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
    const decodedToken = getDecodedToken(encodedToken);
    const tokenAmount = decodedToken.token.reduce((total, { proofs }) => total + proofs.reduce((sum, p) => sum + p.amount, 0), 0);

    // The "swap" is essentially receiving the token and immediately creating a new one for the same amount.
    // This invalidates the proofs the user sent.
    // 1. Receive the token to get its proofs into the wallet's memory.
    const { proofs: receivedProofs } = await this.wallet.receive(encodedToken);
    
    // 2. Send the total amount to create new proofs (the "swap").
    // This operation is internal to the bot's wallet.
    const { returnChange: newProofsForBot, send: proofsForNowhere } = await this.wallet.send(tokenAmount, receivedProofs);

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
        mint_url: this.mint.mintUrl,
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
    const bigIntAmount = BigInt(amount);
    
    const result = await db.transaction(async (tx) => {
      // 1. Lock user row and check balance
      const user = await tx.query.users.findFirst({ where: eq(usersTable.id, userId), for: 'update' });
      if (!user || user.balance < bigIntAmount) {
        throw new Error('Insufficient balance.');
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
      const { returnChange, send } = await this.wallet.send(finalAmount, proofsForSending);
      const encodedToken = this.wallet.getEncodedToken({ token: [{ proofs: send, mint: this.mint.mintUrl }] });

      // 5. Update database
      // Delete used proofs
      await tx.delete(proofsTable).where(inArray(proofsTable.id, proofsToUpdate.map(p => p.id)));

      // Insert change proofs
      if (returnChange.length > 0) {
        const newChangeProofs = returnChange.map(p => ({
          amount: p.amount,
          secret: encrypt(p.secret),
          C: p.C,
          id_set: p.id,
          mint_url: this.mint.mintUrl,
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
    const { amount } = getDecodedToken(invoice);
    if (!amount) {
        throw new Error('Invalid invoice, missing amount.');
    }
    const bigIntAmount = BigInt(amount);

    const result = await db.transaction(async (tx) => {
        const user = await tx.query.users.findFirst({ where: eq(usersTable.id, userId), for: 'update' });
        if (!user || user.balance < bigIntAmount) {
            throw new Error('Insufficient balance.');
        }

        const { selectedProofs, proofsToUpdate, proofsAmount } = await this._selectProofsForAmount(tx, amount);

        const proofsForMelting: Proof[] = selectedProofs.map(p => ({
            ...p.rawProof as Proof,
            secret: decrypt(p.secret),
        }));
        
        const { isPaid, preimage, change } = await this.wallet.payLnInvoice(invoice, proofsForMelting);

        if (isPaid) {
            await tx.delete(proofsTable).where(inArray(proofsTable.id, proofsToUpdate.map(p => p.id)));

            if (change && change.length > 0) {
                const newChangeProofs = change.map(p => ({
                    amount: p.amount,
                    secret: encrypt(p.secret),
                    C: p.C,
                    id_set: p.id,
                    mint_url: this.mint.mintUrl,
                    rawProof: p,
                }));
                await tx.insert(proofsTable).values(newChangeProofs);
            }
            await tx.update(usersTable)
                .set({ balance: user.balance - bigIntAmount })
                .where(eq(usersTable.id, userId));
        } else {
            // If payment fails, release the reserved proofs
            await tx.update(proofsTable).set({ isReserved: false }).where(inArray(proofsTable.id, proofsToUpdate.map(p => p.id)));
        }

        return { isPaid, preimage, change };
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
      throw new Error('Insufficient treasury balance.');
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
