import crypto from 'crypto';
import { BotLanguage, t } from './i18n';
import { auctions } from '../db/schema';

type AuctionRecord = typeof auctions.$inferSelect;

const aliasCache = new Map<string, string>();

const getAliasSeed = (auctionId: number, bidderId: string) => `${auctionId}:${bidderId}`;

export const getPrivacyAlias = (auctionId: number, bidderId: string) => {
  const key = getAliasSeed(auctionId, bidderId);
  if (aliasCache.has(key)) {
    return aliasCache.get(key)!;
  }
  const hash = crypto.createHash('sha256').update(key).digest();
  const number = (hash.readUInt32BE(0) % 9999) + 1;
  const alias = `Bidder #${number}`;
  aliasCache.set(key, alias);
  return alias;
};

export const formatBidderDisplay = (auctionId: number, bidderId: string, isAnonymous: boolean) =>
  isAnonymous ? getPrivacyAlias(auctionId, bidderId) : `<@${bidderId}>`;

export const buildPublicBidMessage = (
  auction: AuctionRecord,
  params: { title: string; id: number; amount: bigint; bidderId: string; endTime: Date; isAnonymous: boolean },
  lang: BotLanguage,
) => {
  const endTimestamp = Math.floor(params.endTime.getTime() / 1000).toString();
  const didExtend = params.endTime.getTime() > auction.endTime.getTime();
  const endNoteKey = didExtend ? 'bid.endNote.extended' : 'bid.endNote.normal';

  return t('bid.success', lang, {
    title: params.title,
    id: params.id.toString(),
    amount: params.amount.toString(),
    bidderDisplay: formatBidderDisplay(auction.id, params.bidderId, params.isAnonymous),
    endNote: t(endNoteKey as any, lang, { timestamp: endTimestamp }),
  });
};

export const buildPublicResultMessage = (
  auction: AuctionRecord,
  params: { amount: bigint; winnerId?: string; isAnonymous?: boolean },
  lang: BotLanguage,
) => {
  if (!params.winnerId) {
    return t('auction.result.noBids', lang);
  }

  const displayWinner = params.isAnonymous
    ? getPrivacyAlias(auction.id, params.winnerId)
    : `<@${params.winnerId}>`;

  return t('auction.result.public', lang, {
    amount: params.amount.toString(),
    winner: displayWinner,
  });
};

export const buildSellerDM = (
  auction: AuctionRecord,
  params: { amount: bigint; winnerId: string; deposit: bigint; remaining: bigint; balance: bigint },
  lang: BotLanguage,
) =>
  t('auction.dm.seller', lang, {
    title: auction.title,
    winner: `<@${params.winnerId}>`,
    amount: params.amount.toString(),
    deposit: params.deposit.toString(),
    remaining: params.remaining.toString(),
    balance: params.balance.toString(),
  });

export const buildWinnerDM = (
  auction: AuctionRecord,
  params: { amount: bigint; deposit: bigint; remaining: bigint; balance: bigint },
  lang: BotLanguage,
) =>
  t('auction.dm.winner', lang, {
    title: auction.title,
    amount: params.amount.toString(),
    deposit: params.deposit.toString(),
    remaining: params.remaining.toString(),
    balance: params.balance.toString(),
  });

export const buildAuditLogMessage = (
  auction: AuctionRecord,
  params: { amount: bigint; winnerId: string },
) =>
  `🔐 Privacy Auction Resolved\n• Auction #${auction.id} (${auction.title})\n• Winner: <@${params.winnerId}>\n• Amount: ${params.amount.toString()} sats`;
