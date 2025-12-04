import type { bids } from '../db/schema';
import { computeCollateral } from '../utils/collateral';

export type BidRecord = typeof bids.$inferSelect;

export type BidderState = {
  userId: string;
  balance: bigint;
  lockedBalance: bigint;
};

export type BidderDisqualification = {
  userId: string;
  collateralReleased: bigint;
};

export type BidEvaluationResult = {
  winner?:
    | {
        bid: BidRecord;
        userId: string;
        collateral: bigint;
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
    const cappedCollateral = computeCollateral(bid.amount, collateralRatio);

    if (!state) {
      disqualified.push({
        userId: bid.bidderId,
        collateralReleased: cappedCollateral,
      });
      continue;
    }

    return {
      winner: {
        bid,
        userId: state.userId,
        collateral: cappedCollateral,
      },
      disqualified,
    };
  }

  return { disqualified };
};
