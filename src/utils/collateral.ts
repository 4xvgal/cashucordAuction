export const computeCollateral = (amount: bigint, ratio: number) => {
  if (ratio <= 0) return amount > 0n ? 1n : 0n;
  let collateral = (amount * BigInt(ratio)) / 100n;
  if (collateral < 1n && amount > 0n) {
    collateral = 1n;
  }
  if (collateral > amount) {
    collateral = amount;
  }
  return collateral;
};
