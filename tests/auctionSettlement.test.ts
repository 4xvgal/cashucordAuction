import { expect, test } from 'bun:test';
import { evaluateBidsForSettlement } from '../src/services/auctionSettlement';
import { bids as bidsTable } from '../src/db/schema';

type BidRecord = typeof bidsTable.$inferSelect;

const buildBid = (overrides: Partial<BidRecord>): BidRecord => ({
  id: overrides.id ?? 0,
  auctionId: overrides.auctionId ?? 1,
  bidderId: overrides.bidderId ?? 'user-1',
  amount: overrides.amount ?? 0n,
  timestamp: overrides.timestamp ?? new Date(),
});

test('selects the highest qualified bidder and releases collateral', () => {
  const orderedBids: BidRecord[] = [
    buildBid({ id: 1, bidderId: 'user-1', amount: 150n }),
    buildBid({ id: 2, bidderId: 'user-2', amount: 120n }),
  ];

  const bidderStates = new Map<string, { userId: string; balance: bigint; lockedBalance: bigint }>([
    ['user-1', { userId: 'user-1', balance: 200n, lockedBalance: 30n }],
    ['user-2', { userId: 'user-2', balance: 80n, lockedBalance: 0n }],
  ]);

  const result = evaluateBidsForSettlement(orderedBids, bidderStates, 20);

  expect(result.winner?.userId).toBe('user-1');
  expect(result.winner?.bid.id).toBe(1);
  expect(result.winner?.collateral).toBe(30n);
  expect(result.disqualified.length).toBe(0);
});

test('disqualifies bids when the bidder record is missing', () => {
  const orderedBids: BidRecord[] = [
    buildBid({ id: 1, bidderId: 'ghost', amount: 210n }),
    buildBid({ id: 2, bidderId: 'user-ok', amount: 180n }),
  ];

  const bidderStates = new Map<string, { userId: string; balance: bigint; lockedBalance: bigint }>([
    ['user-ok', { userId: 'user-ok', balance: 250n, lockedBalance: 20n }],
  ]);

  const result = evaluateBidsForSettlement(orderedBids, bidderStates, 30);

  expect(result.disqualified.map((entry) => entry.userId)).toContain('ghost');
  expect(result.winner?.userId).toBe('user-ok');
  expect(result.winner?.collateral).toBe(54n);
});

test('returns no winner when every bidder entry is missing', () => {
  const orderedBids: BidRecord[] = [
    buildBid({ id: 1, bidderId: 'user-a', amount: 500n }),
  ];

  const bidderStates = new Map<string, { userId: string; balance: bigint; lockedBalance: bigint }>();

  const result = evaluateBidsForSettlement(orderedBids, bidderStates, 10);

  expect(result.winner).toBeUndefined();
  expect(result.disqualified).toHaveLength(1);
});
