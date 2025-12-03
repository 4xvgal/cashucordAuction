import type { bids } from '../db/schema';

export type BidRecord = typeof bids.$inferSelect;

export type BidderState = {
  userId: string;
  balance: bigint;
  lockedBalance: bigint;
};

export type BidderDisqualification = {
  userId: string;
  newLockedBalance: bigint;
  collateralReleased: bigint;
};

export type BidEvaluationResult = {
  winner?:
    | {
        bid: BidRecord;
        userId: string;
        newBalance: bigint;
        newLockedBalance: bigint;
      }
    | undefined;
  disqualified: BidderDisqualification[];
};

export const evaluateBidsForSettlement = (
  orderedBids: BidRecord[],
  bidderStates: Map<string, BidderState>,
  collateralRatio: number,
): BidEvaluationResult => {
  const disqualified: BidderDisqualification[] = [];

  for (const bid of orderedBids) {
    const state = bidderStates.get(bid.bidderId);
    const collateral = (bid.amount * BigInt(collateralRatio)) / 100n;

    if (!state) {
      disqualified.push({
        userId: bid.bidderId,
        newLockedBalance: 0n,
        collateralReleased: collateral,
      });
      continue;
    }

    const newLockedBalance = state.lockedBalance > collateral ? state.lockedBalance - collateral : 0n;

    if (state.balance < bid.amount) {
      disqualified.push({
        userId: state.userId,
        newLockedBalance,
        collateralReleased: collateral,
      });
      continue;
    }

    return {
      winner: {
        bid,
        userId: state.userId,
        newBalance: state.balance - bid.amount,
        newLockedBalance,
      },
      disqualified,
    };
  }

  return { disqualified };
};
