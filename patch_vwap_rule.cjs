const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

// Need to make sure computeVWAP is imported
if (!code.includes('computeVWAP')) {
  code = code.replace("computeSMA, computeEMA } from './technical-indicators';", "computeSMA, computeEMA, computeVWAP } from './technical-indicators';");
}

let vwapLogic = `
    const timeStr = ctx.timeStr || '';
    const isMorning = timeStr >= '09:15' && timeStr <= '10:45';
    
    if (ctx.sessState.isGapDay && isMorning) {
      // Use VWAP instead of 15m EMA
      const todayStr = ctx.timeObj.toISOString().split('T')[0];
      const todayCandles = candles.filter((c: any) => {
        const ts = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
        const d = new Date(ts);
        return d.toISOString().split('T')[0] === todayStr;
      });
      
      if (todayCandles.length > 0) {
        const vwapArray = computeVWAP(todayCandles);
        const currentVwap = vwapArray[vwapArray.length - 1];
        const currentSpot = ctx.spotPrice;
        
        if (!isNaN(currentVwap)) {
          if (setup.direction === 'CALL' && currentSpot <= currentVwap) {
            return fail('FAILED_HTF_ALIGNMENT: Fighting the Intraday VWAP (Gap Day)');
          }
          if (setup.direction === 'PUT' && currentSpot >= currentVwap) {
            return fail('FAILED_HTF_ALIGNMENT: Fighting the Intraday VWAP (Gap Day)');
          }
        }
      }
      return pass();
    }
`;

code = code.replace(
  "// Synthesize 15m closes",
  vwapLogic + "\n    // Synthesize 15m closes"
);

fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('Patched VWAP logic');
