import { expect, test } from 'bun:test';
import { formatBidderDisplay, buildPublicBidMessage, buildPublicResultMessage, buildSellerDM } from '../src/utils/privacy';
import type { BotLanguage } from '../src/utils/i18n';
import { auctions } from '../src/db/schema';

const baseAuction = {
  id: 1,
  sellerId: 'seller',
  title: 'Rare Artifact',
  startPrice: 100n,
  currentPrice: 150n,
  collateralRatio: 20,
  endTime: new Date(),
  status: 'ACTIVE',
  antiSnipeTrigger: 60,
  antiSnipeExtension: 60,
  isPrivacyMode: true,
  winnerId: null,
} as typeof auctions.$inferSelect;

const lang: BotLanguage = 'en';

test('privacy alias masks bidder identity', () => {
  const alias = formatBidderDisplay(baseAuction, 'user123');
  expect(alias.includes('<@')).toBeFalsy();
  expect(alias.startsWith('Bidder #')).toBeTruthy();
});

test('public bid message hides bidder mention when privacy mode is on', () => {
  const message = buildPublicBidMessage(
    baseAuction,
    {
      title: baseAuction.title,
      id: baseAuction.id,
      amount: 200n,
      bidderId: 'user123',
      endTime: new Date(),
    },
    lang,
  );
  expect(message.includes('<@user123>')).toBeFalsy();
  expect(message.includes('Bidder #')).toBeTruthy();
});

test('auction conclusion hides winner publicly but includes in private DM', () => {
  const concludedAuction = { ...baseAuction, status: 'ENDED' as const, winnerId: 'winner123', isPrivacyMode: true };
  const publicMessage = buildPublicResultMessage(concludedAuction, { amount: 500n, winnerId: 'winner123' }, lang);
  expect(publicMessage.includes('<@winner123>')).toBeFalsy();

  const sellerDm = buildSellerDM(concludedAuction, { amount: 500n, winnerId: 'winner123' }, lang);
  expect(sellerDm.includes('<@winner123>')).toBeTruthy();
});
