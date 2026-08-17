const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/const conf = 85;/g, `
    const timeWindow = this.getTimeWindow(nowMs);
    const conf = calculateConfidence({
      rewardRiskRatio: rewardSpot / riskSpot,
      premiumExpansion: 1.0,
      oiState: 1.0,
      spreadPercent: 1.0, // TODO: Use real spread
      ivRegime: 1.0,
      momentum: 1.0,
      gapState: 0,
      timeWindow,
      isExpiryAfter14: false, // TODO
      feedSyncPenalty: sessState.feedSyncPenalty || 0
    });
`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
