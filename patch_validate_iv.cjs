const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /setup\.premiumPauseHigh = pauseHigh;\n\s*\}/m;

const replacement = `setup.premiumPauseHigh = pauseHigh;
    }
    
    let ivSum = 0;
    let ivCount = 0;
    for (let i = 0; i < 5; i++) {
       const idx = (breakCandleIndex ?? -1) - 1 - i;
       if (idx >= 0) {
          const pb = this.getAlignedPremiumCandle(selectedStrike, selectedType, valCtx.candles1m[idx]);
          if (pb && pb.iv > 0) {
             ivSum += pb.iv;
             ivCount++;
          }
       }
    }
    setup.ivAvg = ivCount > 0 ? ivSum / ivCount : 0;`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 4 ivAvg complete');
