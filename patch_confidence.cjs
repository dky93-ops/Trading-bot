const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const calcConf = `
  private calculateDeterministicConfidence(setup: ProposedSetup): number {
    let score = 50;
    score += 20; // mandatory entry conditions passed
    if ((setup.rewardToRiskTarget1 || 0) >= 1.0) score += 10;
    if ((setup.rewardToRiskTarget2 || 0) >= 1.5) score += 5;
    if ((setup.premiumExpansionPercent || 0) >= 1.5) score += 10;
    if ((setup.oiWeakeningPercent || 0) >= 10) score += 10;
    if (!setup.outsidePreferredWindow) score += 5;
    if ((setup.spreadPercent || 999) <= 1.5) score += 5;
    if (setup.ivFavorable === true) score += 5;
    if (setup.strongMomentum === true) score += 5;
    if (setup.gapRulePassed === true) score += 5;

    if (setup.outsidePreferredWindow) score -= 10;
    if ((setup.spreadPercent || 0) > 1.5 && (setup.spreadPercent || 0) <= 3) score -= 10;
    if (setup.ivFavorable === false) score -= 10;
    score -= Number(setup.feedSyncPenalty || 0);

    const nowHHMM = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata'
    });
    if (nowHHMM >= '09:20' && nowHHMM < '10:00') score -= 5;
    if (setup.expiryDayAfter14 === true) score -= 10;
    
    score = Math.max(0, Math.min(100, score));

    if (setup.expiryDayAfter14 === true) {
      if (
        score < 70 ||
        (setup.rewardToRiskTarget1 || 0) < 1.0 ||
        (setup.spreadPercent || 999) > 1.5 ||
        (setup.oiWeakeningPercent || 0) < 7.5
      ) {
        return 0;
      }
    }
    return score;
  }
`;

code = code.replace(/private createSignal\(/, calcConf + "\n  $&");
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Added calculateDeterministicConfidence');
