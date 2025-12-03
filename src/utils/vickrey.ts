export type SimpleBid = {
  bidderId: string;
  amount: bigint;
};

export const determineVickreyPrice = (
  bids: SimpleBid[],
  winnerId: string,
  startPrice: bigint,
) => {
  const runnerUp = bids.find((bid) => bid.bidderId !== winnerId);
  let payout = runnerUp ? runnerUp.amount : startPrice;
  const winnerBid = bids.find((bid) => bid.bidderId === winnerId);
  if (winnerBid && payout > winnerBid.amount) {
    payout = winnerBid.amount;
  }
  return payout;
};
