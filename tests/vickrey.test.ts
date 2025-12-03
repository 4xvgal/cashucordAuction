import { expect, test } from 'bun:test';
import { determineVickreyPrice } from '../src/utils/vickrey';

test('vickrey payout uses second price when multiple bids exist', () => {
  const bids = [
    { bidderId: 'userB', amount: 150n },
    { bidderId: 'userA', amount: 100n },
  ];
  const payout = determineVickreyPrice(bids, 'userB', 50n);
  expect(payout).toBe(100n);
});

test('vickrey payout falls back to start price when single bidder', () => {
  const bids = [{ bidderId: 'userA', amount: 120n }];
  const payout = determineVickreyPrice(bids, 'userA', 40n);
  expect(payout).toBe(40n);
});
