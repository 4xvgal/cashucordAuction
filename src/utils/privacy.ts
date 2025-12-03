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

export const formatBidderDisplay = (auction: AuctionRecord, bidderId: string) =>
  auction.isPrivacyMode ? getPrivacyAlias(auction.id, bidderId) : `<@${bidderId}>`;

export const buildPublicBidMessage = (
  auction: AuctionRecord,
  params: { title: string; id: number; amount: bigint; bidderId: string; endTime: Date },
  lang: BotLanguage,
) => {
  const endTimestamp = Math.floor(params.endTime.getTime() / 1000).toString();
  const didExtend = params.endTime.getTime() > auction.endTime.getTime();
  const endNoteKey = didExtend ? 'bid.endNote.extended' : 'bid.endNote.normal';

  return t('bid.success', lang, {
    title: params.title,
    id: params.id.toString(),
    amount: params.amount.toString(),
    bidderDisplay: formatBidderDisplay(auction, params.bidderId),
    endNote: t(endNoteKey as any, lang, { timestamp: endTimestamp }),
  });
};

export const buildPublicResultMessage = (
  auction: AuctionRecord,
  params: { amount: bigint; winnerId?: string },
  lang: BotLanguage,
) => {
  if (auction.isPrivacyMode) {
    return t('auction.result.privacy', lang, { amount: params.amount.toString() });
  }
  if (params.winnerId) {
    return t('auction.result.public', lang, {
      amount: params.amount.toString(),
      winner: `<@${params.winnerId}>`,
    });
  }
  return t('auction.result.noBids', lang);
};

export const buildSellerDM = (
  auction: AuctionRecord,
  params: { amount: bigint; winnerId: string },
  lang: BotLanguage,
) =>
  t('auction.dm.seller', lang, {
    title: auction.title,
    winner: `<@${params.winnerId}>`,
    amount: params.amount.toString(),
  });

export const buildWinnerDM = (
  auction: AuctionRecord,
  params: { amount: bigint },
  lang: BotLanguage,
) =>
  t('auction.dm.winner', lang, {
    title: auction.title,
    amount: params.amount.toString(),
  });

export const buildAuditLogMessage = (
  auction: AuctionRecord,
  params: { amount: bigint; winnerId: string },
) =>
  `🔐 Privacy Auction Resolved\n• Auction #${auction.id} (${auction.title})\n• Winner: <@${params.winnerId}>\n• Amount: ${params.amount.toString()} sats`;
