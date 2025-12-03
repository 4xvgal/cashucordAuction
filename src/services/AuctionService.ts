import moment from 'moment';
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import { db } from '../db';
import { auctions, bids, users } from '../db/schema';
import { AppError } from '../utils/errors';
import {
  BidderState,
  BidEvaluationResult,
  evaluateBidsForSettlement,
} from './auctionSettlement';

type AuctionRecord = typeof auctions.$inferSelect;
type BidRecord = typeof bids.$inferSelect;
type UserRecord = typeof users.$inferSelect;

type AuctionListStatus = 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'ALL';

export type AuctionListItem = {
  auction: AuctionRecord;
  topBid?: BidRecord;
};

export class AuctionService {
  private finalizerHandle: ReturnType<typeof setInterval> | undefined;
  private finalizerRunning = false;
  private missingSchemaNotified = false;

  constructor(private readonly database = db) {}

  startFinalizer(intervalMs = 15_000) {
    if (this.finalizerHandle) {
      return;
    }

    this.finalizerHandle = setInterval(async () => {
      if (this.finalizerRunning) return;
      this.finalizerRunning = true;
      try {
        await this.finalizeExpiredAuctions();
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
        await tx
          .update(users)
          .set({ lockedBalance: disqualified.newLockedBalance })
          .where(eq(users.id, disqualified.userId));
      }

      if (!evaluation.winner) {
        await tx.update(auctions).set({ status: 'CANCELLED' }).where(eq(auctions.id, auction.id));
        return { status: 'CANCELLED', auctionId, reason: 'NO_ELIGIBLE_BIDS' };
      }

      const winnerState = evaluation.winner;

      await tx
        .update(users)
        .set({
          balance: winnerState.newBalance,
          lockedBalance: winnerState.newLockedBalance,
        })
        .where(eq(users.id, winnerState.userId));

      let seller = await tx.query.users.findFirst({ where: eq(users.id, auction.sellerId), for: 'update' });
      if (!seller) {
        await tx.insert(users).values({ id: auction.sellerId }).onConflictDoNothing();
        seller = await tx.query.users.findFirst({ where: eq(users.id, auction.sellerId), for: 'update' });
      }

      const sellerBalance = seller?.balance ?? 0n;
      await tx
        .update(users)
        .set({ balance: sellerBalance + winnerState.bid.amount })
        .where(eq(users.id, auction.sellerId));

      await tx
        .update(auctions)
        .set({
          status: 'ENDED',
          currentPrice: winnerState.bid.amount,
        })
        .where(eq(auctions.id, auction.id));

      return {
        status: 'ENDED',
        auctionId,
        winnerId: winnerState.userId,
        bidAmount: winnerState.bid.amount,
        disqualified: evaluation.disqualified.map((entry) => entry.userId),
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
