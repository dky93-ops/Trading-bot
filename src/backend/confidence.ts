export interface ConfidenceInput {
  rewardRiskRatio: number;
  premiumExpansion: number;
  oiState: number;
  spreadPercent: number;
  ivRegime: number;
  momentum: number;
  gapState: number;
  timeWindow: string; // '09:15-09:20', '09:20-10:00', '10:00-12:30', '12:30-13:30', '13:30-15:00', 'POST-15:00'
  isExpiryAfter14: boolean;
  feedSyncPenalty: number;
}

export function calculateConfidence(input: ConfidenceInput): number {
  let score = 70; // Base score

  // Reward/Risk
  if (input.rewardRiskRatio >= 2.0) score += 10;
  else if (input.rewardRiskRatio >= 1.5) score += 5;
  else if (input.rewardRiskRatio < 0.8) score -= 20;
  else if (input.rewardRiskRatio < 1.0) score -= 10;

  // Premium expansion
  if (input.premiumExpansion > 1.5) score += 5;
  else if (input.premiumExpansion < 1.0) score -= 5;

  // OI state
  if (input.oiState > 2.0) score += 5;
  else if (input.oiState < 1.5) score -= 10;

  // Spread
  if (input.spreadPercent > 1.5 && input.isExpiryAfter14) score -= 20;
  else if (input.spreadPercent > 3.0) score -= 20;
  else if (input.spreadPercent < 0.5) score += 5;

  // Time window
  if (input.timeWindow === '10:00-12:30') score += 5;
  if (input.timeWindow === '09:15-09:20' || input.timeWindow === 'POST-15:00') score -= 50;

  // Penalties
  score -= input.feedSyncPenalty || 0;

  return Math.max(0, Math.min(100, score));
}
