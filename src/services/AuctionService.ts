import moment from 'moment';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { Client } from 'discord.js';
import { db } from '../db';
import { auctions, bids, users } from '../db/schema';
import { AppError } from '../utils/errors';
import {
  BidderState,
  BidEvaluationResult,
  evaluateBidsForSettlement,
} from './auctionSettlement';
import { determineVickreyPrice } from '../utils/vickrey';
import { buildAuditLogMessage, buildPublicResultMessage, buildSellerDM, buildWinnerDM } from '../utils/privacy';
import { computeCollateral } from '../utils/collateral';
import { getDefaultLanguage } from '../utils/i18n';
import { walletService } from './WalletService';

type AuctionRecord = typeof auctions.$inferSelect;
type BidRecord = typeof bids.$inferSelect;
type UserRecord = typeof users.$inferSelect;

type AuctionListStatus = 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'ALL';

export type AuctionListItem = {
  auction: AuctionRecord;
  topBid?: BidRecord;
};

type FinalizedAuctionResult = {
  status: 'ENDED';
  auction: AuctionRecord;
  winnerId: string;
  bidAmount: bigint;
  depositAmount: bigint;
  winnerIsAnonymous: boolean;
  buyerBalance: bigint;
  sellerBalance: bigint;
};

export class AuctionService {
  private finalizerHandle: ReturnType<typeof setInterval> | undefined;
  private finalizerRunning = false;
  private missingSchemaNotified = false;
  private client?: Client;
  private readonly announceChannelId = process.env.AUCTION_RESULTS_CHANNEL_ID;
  private readonly auditChannelId = process.env.AUDIT_LOG_CHANNEL_ID;

  constructor(private readonly database = db) {}

  attachClient(client: Client) {
    this.client = client;
  }

  startFinalizer(intervalMs = 15_000, client?: Client) {
    if (client) {
      this.client = client;
    }
    if (this.finalizerHandle) {
      return;
    }

    this.finalizerHandle = setInterval(async () => {
      if (this.finalizerRunning) return;
      this.finalizerRunning = true;
      try {
        const results = await this.finalizeExpiredAuctions();
        for (const result of results) {
          if (result && result.status === 'ENDED') {
            await this.announceConclusion(result as FinalizedAuctionResult);
          }
        }
      } catch (error) {
        console.error('Auction finalizer error:', error);
      } finally {
        this.finalizerRunning = false;
      }
    }, intervalMs);
  }

  stopFinalizer() {
    if (this.finalizerHandle) {
      clearInterval(this.finalizerHandle);
      this.finalizerHandle = undefined;
    }
  }

  async finalizeExpiredAuctions(limit = 20) {
    const now = new Date();
    let endingAuctions: AuctionRecord[] = [];
    try {
      endingAuctions = await this.database.query.auctions.findMany({
        where: and(eq(auctions.status, 'ACTIVE'), lte(auctions.endTime, now)),
        orderBy: [asc(auctions.endTime)],
        limit,
      });
      this.missingSchemaNotified = false;
    } catch (error) {
      if (this.isMissingRelationError(error)) {
        return [];
      }
      throw error;
    }

    const results = [];
    for (const auction of endingAuctions) {
      const result = await this.finalizeAuction(auction.id);
      results.push(result);
    }
    return results;
  }

  async finalizeAuction(auctionId: number) {
    return this.database.transaction(async (tx) => {
      const auction = await tx.query.auctions.findFirst({
        where: eq(auctions.id, auctionId),
        for: 'update',
      });

      if (!auction) {
        throw new AppError('Auction not found.', 'AUCTION_NOT_FOUND');
      }

      if (auction.status !== 'ACTIVE') {
        return { status: auction.status, auctionId };
      }

      if (moment().isBefore(auction.endTime)) {
        throw new AppError('Auction has not reached its end time yet.', 'AUCTION_ENDED');
      }

      const sortedBids = await tx.query.bids.findMany({
        where: eq(bids.auctionId, auction.id),
        orderBy: [desc(bids.amount), desc(bids.timestamp)],
      });

      if (sortedBids.length === 0) {
        await tx.update(auctions).set({ status: 'CANCELLED' }).where(eq(auctions.id, auction.id));
        return { status: 'CANCELLED', auctionId, reason: 'NO_BIDS' };
      }

      const bidderIds = [...new Set(sortedBids.map((bid) => bid.bidderId))];
      const bidderRecords: UserRecord[] = [];
      if (bidderIds.length > 0) {
        const fetchedBidders = await tx.query.users.findMany({
          where: inArray(users.id, bidderIds),
          for: 'update',
        });
        bidderRecords.push(...fetchedBidders);
      }

      const bidderStates = new Map<string, BidderState>(
        bidderRecords.map((record) => [
          record.id,
          {
            userId: record.id,
            balance: record.balance ?? 0n,
            lockedBalance: record.lockedBalance ?? 0n,
          },
        ]),
      );

      const evaluation = evaluateBidsForSettlement(sortedBids, bidderStates, auction.collateralRatio);

      for (const disqualified of evaluation.disqualified) {
        if (!bidderStates.has(disqualified.userId)) continue;
        const releaseAmount = disqualified.collateralReleased;
        if (releaseAmount > 0n) {
          await tx
            .update(users)
            .set({
              lockedBalance: sql`${users.lockedBalance} - ${releaseAmount}`,
              balance: sql`${users.balance} + ${releaseAmount}`,
            })
            .where(eq(users.id, disqualified.userId));
        }
      }

      if (!evaluation.winner) {
        await tx.update(auctions).set({ status: 'CANCELLED' }).where(eq(auctions.id, auction.id));
        return { status: 'CANCELLED', auctionId, reason: 'NO_ELIGIBLE_BIDS' };
      }

      const winnerState = evaluation.winner;

      let finalPrice = winnerState.bid.amount;
      if (auction.auctionMode === 'VICKREY') {
        finalPrice = determineVickreyPrice(
          sortedBids.map((bid) => ({ bidderId: bid.bidderId, amount: bid.amount })),
          winnerState.userId,
          auction.startPrice,
        );
      }

      const depositAmount = winnerState.collateral;
      const winnerRow = await tx.query.users.findFirst({
        where: eq(users.id, winnerState.userId),
        for: 'update',
      });
      if (!winnerRow) {
        throw new AppError('Winner account missing.', 'AUCTION_NOT_FOUND');
      }
      const currentWinnerLocked = winnerRow.lockedBalance ?? 0n;
      const winnerLockedAfter =
        currentWinnerLocked > depositAmount ? currentWinnerLocked - depositAmount : currentWinnerLocked;
      const winnerBalanceAfter = winnerRow.balance ?? 0n;

      await tx
        .update(users)
        .set({
          lockedBalance: winnerLockedAfter,
        })
        .where(eq(users.id, winnerState.userId));

      let seller = await tx.query.users.findFirst({ where: eq(users.id, auction.sellerId), for: 'update' });
      if (!seller) {
        await tx.insert(users).values({ id: auction.sellerId }).onConflictDoNothing();
        seller = await tx.query.users.findFirst({ where: eq(users.id, auction.sellerId), for: 'update' });
      }

      const sellerBalance = seller?.balance ?? 0n;
      const sellerBalanceAfter = sellerBalance + depositAmount;
      await tx
        .update(users)
        .set({ balance: sellerBalanceAfter })
        .where(eq(users.id, auction.sellerId));

      const updatedAuction: AuctionRecord = {
        ...auction,
        status: 'ENDED',
        currentPrice: finalPrice,
        finalPrice,
        winnerId: winnerState.userId,
      };

      await tx
        .update(auctions)
        .set({
          status: 'ENDED',
          currentPrice: finalPrice,
          finalPrice,
          winnerId: winnerState.userId,
        })
        .where(eq(auctions.id, auction.id));

      return {
        status: 'ENDED' as const,
        auction: updatedAuction,
        winnerId: winnerState.userId,
        bidAmount: finalPrice,
        depositAmount,
        winnerIsAnonymous: winnerState.bid.isAnonymous ?? false,
        buyerBalance: winnerBalanceAfter,
        sellerBalance: sellerBalanceAfter,
      };
    }, { isolationLevel: 'serializable' });
  }

  async listAuctions(params: { status?: AuctionListStatus; limit?: number } = {}): Promise<AuctionListItem[]> {
    const status = params.status ?? 'ACTIVE';
    const limit = params.limit ?? 5;

    const whereClause =
      status === 'ALL'
        ? undefined
        : eq(auctions.status, status as 'ACTIVE' | 'ENDED' | 'CANCELLED');

    const orderBy = status === 'ACTIVE'
      ? [asc(auctions.endTime)]
      : [desc(auctions.endTime)];

    let records: AuctionRecord[] = [];
    try {
      records = await this.database.query.auctions.findMany({
        where: whereClause,
        orderBy,
        limit,
      });
      this.missingSchemaNotified = false;
    } catch (error) {
      if (this.isMissingRelationError(error)) {
        return [];
      }
      throw error;
    }

    const items: AuctionListItem[] = [];
    for (const record of records) {
      const topBid = await this.database.query.bids.findFirst({
        where: eq(bids.auctionId, record.id),
        orderBy: [desc(bids.amount), desc(bids.timestamp)],
      });
      items.push({ auction: record, topBid: topBid ?? undefined });
    }

    return items;
  }

  async announceConclusion(result: FinalizedAuctionResult) {
    if (!this.client) return;
    const lang = getDefaultLanguage();
    const publicMessage = buildPublicResultMessage(
      result.auction,
      {
        amount: result.bidAmount,
        winnerId: result.winnerId,
        isAnonymous: result.winnerIsAnonymous,
      },
      lang,
    );

    if (this.announceChannelId) {
      try {
        const channel = await this.client.channels.fetch(this.announceChannelId);
        if (channel && channel.isTextBased()) {
          await channel.send(publicMessage);
        }
      } catch (error) {
        console.error('Failed to send auction announcement:', error);
      }
    }

    const remaining = result.bidAmount - result.depositAmount;
    await this.notifySeller(result, lang, remaining);
    await this.notifyWinner(result, lang, remaining);
    await this.writeAuditLog(result, remaining);
  }

  private async notifySeller(result: FinalizedAuctionResult, lang: string, remaining: bigint) {
    if (!this.client) return;
    try {
      const sellerUser = await this.client.users.fetch(result.auction.sellerId);
      await sellerUser.send(
        buildSellerDM(
          result.auction,
          {
            amount: result.bidAmount,
            winnerId: result.winnerId,
            deposit: result.depositAmount,
            remaining,
            balance: result.sellerBalance,
          },
          lang,
        ),
      );
    } catch (error) {
      console.error('Failed to DM seller about auction result:', error);
    }
  }

  private async notifyWinner(result: FinalizedAuctionResult, lang: string, remaining: bigint) {
    if (!this.client) return;
    try {
      const winnerUser = await this.client.users.fetch(result.winnerId);
      await winnerUser.send(
        buildWinnerDM(
          result.auction,
          {
            amount: result.bidAmount,
            deposit: result.depositAmount,
            remaining,
            balance: result.buyerBalance,
          },
          lang,
        ),
      );
    } catch (error) {
      console.error('Failed to DM winner about auction result:', error);
    }
  }

  private async writeAuditLog(result: FinalizedAuctionResult, remaining: bigint) {
    if (!this.client || !this.auditChannelId) return;
    try {
      const channel = await this.client.channels.fetch(this.auditChannelId);
      if (channel && channel.isTextBased()) {
        await channel.send(
          buildAuditLogMessage(result.auction, {
            amount: result.bidAmount,
            winnerId: result.winnerId,
          }) + `\nDeposit: ${result.depositAmount.toString()} sats\nRemaining: ${remaining.toString()} sats`,
        );
      }
    } catch (error) {
      console.error('Failed to write to audit log channel:', error);
    }
  }

  private isMissingRelationError(error: unknown) {
    const cause = (error as any)?.cause ?? error;
    const code = cause?.code;
    const message: string = cause?.message ?? (error as any)?.message ?? '';

    if (code === '42P01' || /relation .*does not exist/i.test(message)) {
      if (!this.missingSchemaNotified) {
        console.warn(
          'Auction tables missing in the database. Run migrations (bun run db:migrate) before using the bot.',
        );
        this.missingSchemaNotified = true;
      }
      return true;
    }
    return false;
  }
}

export const auctionService = new AuctionService();
