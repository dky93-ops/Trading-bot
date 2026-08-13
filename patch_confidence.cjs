const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /private calculateDeterministicConfidence\([\s\S]*?\n  \}\n\n  private/m;

const replacement = `private calculateDeterministicConfidence(setup: ProposedSetup): number {
  let score = 50; // Base score (assuming structural validation passed)
  score += 20; // Structural entry gate passed
  
  if ((setup.rewardToRiskTarget1 || 0) >= 1.0) score += 10;
  if ((setup.rewardToRiskTarget2 || 0) >= 1.5) score += 5;
  
  const bp = setup.premiumBreakClose ?? setup.premiumAtBreak ?? 0;
  const cp = setup.premiumConfirmationClose ?? setup.premiumAtConfirmation ?? 0;
  if (bp > 0 && cp > bp) {
    const expansion = ((cp - bp) / bp) * 100;
    if (expansion >= 1.5) score += 10;
  }
  
  if (setup.setupType === 'OI_WALL_REJECTION') {
    if (setup.wallWeakeningConfirmed) score += 10;
  }

  if (setup.earlyWindow && !setup.earlyStrongWindow) {
    score -= 10;
  }
  
  if ((setup.spreadPercent || 999) <= 1.5) score += 5;
  if ((setup.spreadPercent || 0) > 1.5 && (setup.spreadPercent || 0) <= 3.0) score -= 10;
  
  if (setup.ivPenalty) {
    score -= setup.ivPenalty;
  }
  
  if (setup.feedSyncPenalty) {
    score -= setup.feedSyncPenalty;
  }
  
  return Math.max(0, Math.min(100, score));
}

  private`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 7 confidence complete');
