import { describe, expect, it } from 'vitest';
import { calculateConfidence, ConfidenceInput } from '../src/backend/validation-rules';

describe('calculateConfidence', () => {
  const baseInput: ConfidenceInput = {
    rewardRiskRatio: 1.5,
    premiumExpansion: 1.1,
    oiState: 1.6,
    spreadPercent: 1.0,
    ivRegime: 1.0,
    momentum: 1.0,
    gapState: 0,
    timeWindow: '10:00-12:30',
    isExpiryAfter14: false,
    feedSyncPenalty: 0
  };

  it('calculates a baseline passing confidence', () => {
    const conf = calculateConfidence(baseInput);
    expect(conf).toBeGreaterThanOrEqual(70);
  });

  it('reduces confidence for poor RR', () => {
    const conf = calculateConfidence({ ...baseInput, rewardRiskRatio: 0.9 });
    expect(conf).toBeLessThan(70);
  });

  it('reduces confidence for high feed sync penalty', () => {
    const conf = calculateConfidence({ ...baseInput, feedSyncPenalty: 25 });
    expect(conf).toBeLessThan(70);
  });
});
