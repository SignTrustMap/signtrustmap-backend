/**
 * Calculate confirmation credit reward based on sign freshness.
 * - < 3 days: 1 credit (nominal)
 * - 3 <= days < 14: 3 credits
 * - 14 <= days < 30: 10 credits (base reward)
 * - >= 30 days: 15 credits (bounty reward)
 */
export function calculateConfirmationReward(
  lastVerifiedAt: Date | string | null,
  createdAt: Date | string,
  referenceDate: Date = new Date(),
): number {
  const ref = lastVerifiedAt ? new Date(lastVerifiedAt) : new Date(createdAt);
  const diffMs = Math.max(0, referenceDate.getTime() - ref.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 3) {
    return 1;
  } else if (diffDays < 14) {
    return 3;
  } else if (diffDays < 30) {
    return 10;
  } else {
    return 15;
  }
}
