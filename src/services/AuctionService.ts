import moment from 'moment';
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import { Client } from 'discord.js';
import { db } from '../db';
import { auctions, bids, users } from '../db/schema';
import { AppError } from '../utils/errors';
import {
  BidderState,
  BidEvaluationResult,
  evaluateBidsForSettlement,
} from './auctionSettlement';
import { buildAuditLogMessage, buildPublicResultMessage, buildSellerDM, buildWinnerDM } from '../utils/privacy';
import { getDefaultLanguage } from '../utils/i18n';

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
            await this.handleConclusion(result as FinalizedAuctionResult);
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

      const updatedAuction: AuctionRecord = {
        ...auction,
        status: 'ENDED',
        currentPrice: winnerState.bid.amount,
        winnerId: winnerState.userId,
      };

      await tx
        .update(auctions)
        .set({
          status: 'ENDED',
          currentPrice: winnerState.bid.amount,
          winnerId: winnerState.userId,
        })
        .where(eq(auctions.id, auction.id));

      return {
        status: 'ENDED' as const,
        auction: updatedAuction,
        winnerId: winnerState.userId,
        bidAmount: winnerState.bid.amount,
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

  private async handleConclusion(result: FinalizedAuctionResult) {
    if (!this.client) return;
    const lang = getDefaultLanguage();
    const publicMessage = buildPublicResultMessage(result.auction, { amount: result.bidAmount, winnerId: result.winnerId }, lang);

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

    try {
      const sellerUser = await this.client.users.fetch(result.auction.sellerId);
      await sellerUser.send(buildSellerDM(result.auction, { amount: result.bidAmount, winnerId: result.winnerId }, lang));
    } catch (error) {
      console.error('Failed to DM seller about auction result:', error);
    }

    try {
      const winnerUser = await this.client.users.fetch(result.winnerId);
      await winnerUser.send(buildWinnerDM(result.auction, { amount: result.bidAmount }, lang));
    } catch (error) {
      console.error('Failed to DM winner about auction result:', error);
    }

    if (this.auditChannelId) {
      try {
        const channel = await this.client.channels.fetch(this.auditChannelId);
        if (channel && channel.isTextBased()) {
          await channel.send(buildAuditLogMessage(result.auction, { amount: result.bidAmount, winnerId: result.winnerId }));
        }
      } catch (error) {
        console.error('Failed to write to audit log channel:', error);
      }
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
