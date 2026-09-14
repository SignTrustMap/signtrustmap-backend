import { calculateConfirmationReward } from './sign-freshness';

describe('calculateConfirmationReward', () => {
  const reference = new Date('2026-09-14T12:00:00Z');

  it('awards 1 credit for signs refreshed within 3 days (< 3 days)', () => {
    // 0 days ago (just now)
    expect(calculateConfirmationReward(reference, reference, reference)).toBe(1);

    // 1 day ago
    const oneDayAgo = new Date('2026-09-13T12:00:00Z');
    expect(calculateConfirmationReward(oneDayAgo, oneDayAgo, reference)).toBe(1);

    // 2.9 days ago
    const twoPointNineDaysAgo = new Date('2026-09-11T14:30:00Z');
    expect(calculateConfirmationReward(twoPointNineDaysAgo, twoPointNineDaysAgo, reference)).toBe(1);
  });

  it('awards 3 credits for signs refreshed between 3 and 14 days (3 <= days < 14)', () => {
    // Exactly 3 days ago
    const threeDaysAgo = new Date('2026-09-11T12:00:00Z');
    expect(calculateConfirmationReward(threeDaysAgo, threeDaysAgo, reference)).toBe(3);

    // 7 days ago
    const sevenDaysAgo = new Date('2026-09-07T12:00:00Z');
    expect(calculateConfirmationReward(sevenDaysAgo, sevenDaysAgo, reference)).toBe(3);

    // 13.9 days ago
    const thirteenPointNineDaysAgo = new Date('2026-08-31T15:00:00Z');
    expect(calculateConfirmationReward(thirteenPointNineDaysAgo, thirteenPointNineDaysAgo, reference)).toBe(3);
  });

  it('awards 10 credits for signs refreshed between 14 and 30 days (14 <= days < 30)', () => {
    // Exactly 14 days ago
    const fourteenDaysAgo = new Date('2026-08-31T12:00:00Z');
    expect(calculateConfirmationReward(fourteenDaysAgo, fourteenDaysAgo, reference)).toBe(10);

    // 25 days ago
    const twentyFiveDaysAgo = new Date('2026-08-20T12:00:00Z');
    expect(calculateConfirmationReward(twentyFiveDaysAgo, twentyFiveDaysAgo, reference)).toBe(10);

    // 29.9 days ago
    const twentyNinePointNineDaysAgo = new Date('2026-08-15T15:00:00Z');
    expect(calculateConfirmationReward(twentyNinePointNineDaysAgo, twentyNinePointNineDaysAgo, reference)).toBe(10);
  });

  it('awards 15 credits (bounty) for signs not refreshed in 30+ days (>= 30 days)', () => {
    // Exactly 30 days ago
    const thirtyDaysAgo = new Date('2026-08-15T12:00:00Z');
    expect(calculateConfirmationReward(thirtyDaysAgo, thirtyDaysAgo, reference)).toBe(15);

    // 90 days ago
    const ninetyDaysAgo = new Date('2026-06-16T12:00:00Z');
    expect(calculateConfirmationReward(ninetyDaysAgo, ninetyDaysAgo, reference)).toBe(15);
  });

  it('falls back to createdAt if lastVerifiedAt is null', () => {
    const thirtyFiveDaysAgo = new Date('2026-08-10T12:00:00Z');
    expect(calculateConfirmationReward(null, thirtyFiveDaysAgo, reference)).toBe(15);

    const twoDaysAgo = new Date('2026-09-12T12:00:00Z');
    expect(calculateConfirmationReward(null, twoDaysAgo, reference)).toBe(1);
  });
});
