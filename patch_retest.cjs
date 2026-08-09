const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const helpers = `
  private getCompletedCandleKey(candle: Candle): string {
    return new Date(candle.timestamp).toISOString();
  }

  private getCompletedCandleIndexByTimestamp(candles: Candle[], timestamp: string): number {
    return candles.findIndex(c => new Date(c.timestamp).toISOString() === timestamp);
  }
`;

// Insert helpers if missing
if (!code.includes('getCompletedCandleKey(')) {
  code = code.replace(/private isMarketOpen\(\): boolean \{/, helpers + '\n  private isMarketOpen(): boolean {');
}

function patchFunction(funcName) {
  let startIndex = code.indexOf(`private async ${funcName}`);
  if (startIndex === -1) return;
  let endIndex = code.indexOf('private async', startIndex + 10);
  if (endIndex === -1) endIndex = code.length;
  
  let funcBody = code.substring(startIndex, endIndex);

  // FAILED_RETEST / OPENING_TRAP CALL patch
  funcBody = funcBody.replace(/const barsSinceBreak = callRetestIdx - callBreakIdx;\s*const barsSinceRetest = c0Index - callRetestIdx;/, `const confirmationCandleIndex = this.getCompletedCandleIndexByTimestamp(candles, this.getCompletedCandleKey(c0));
          const breakCandleIndex = this.getCompletedCandleIndexByTimestamp(candles, this.getCompletedCandleKey(candles[callBreakIdx]));
          const retestCandleIndex = this.getCompletedCandleIndexByTimestamp(candles, this.getCompletedCandleKey(candles[callRetestIdx]));
          const barsSinceBreakout = retestCandleIndex - breakCandleIndex;
          const barsSinceRetest = confirmationCandleIndex - retestCandleIndex;`);
          
  // FAILED_RETEST / OPENING_TRAP PUT patch
  funcBody = funcBody.replace(/const barsSinceBreak = putRetestIdx - putBreakIdx;\s*const barsSinceRetest = c0Index - putRetestIdx;/, `const confirmationCandleIndex = this.getCompletedCandleIndexByTimestamp(candles, this.getCompletedCandleKey(c0));
          const breakCandleIndex = this.getCompletedCandleIndexByTimestamp(candles, this.getCompletedCandleKey(candles[putBreakIdx]));
          const retestCandleIndex = this.getCompletedCandleIndexByTimestamp(candles, this.getCompletedCandleKey(candles[putRetestIdx]));
          const barsSinceBreakout = retestCandleIndex - breakCandleIndex;
          const barsSinceRetest = confirmationCandleIndex - retestCandleIndex;`);

  // Now replace the parameters in validateSetup
  funcBody = funcBody.replace(/barsSinceBreak, barsSinceRetest, undefined, spot - [^,]+, callBreakIdx, callRetestIdx, c0Index/g, 'barsSinceBreakout, barsSinceRetest, undefined, spot - lvl, breakCandleIndex, retestCandleIndex, confirmationCandleIndex');
  funcBody = funcBody.replace(/barsSinceBreak, barsSinceRetest, undefined, spot - sess.openingRangeHigh, callBreakIdx, callRetestIdx, c0Index/g, 'barsSinceBreakout, barsSinceRetest, undefined, spot - sess.openingRangeHigh, breakCandleIndex, retestCandleIndex, confirmationCandleIndex');
  funcBody = funcBody.replace(/barsSinceBreak, barsSinceRetest, undefined, spot - sess.openingRangeLow, putBreakIdx, putRetestIdx, c0Index/g, 'barsSinceBreakout, barsSinceRetest, undefined, spot - sess.openingRangeLow, breakCandleIndex, retestCandleIndex, confirmationCandleIndex');

  funcBody = funcBody.replace(/barsSinceBreak, barsSinceRetest, undefined, spot - lvl, putBreakIdx, putRetestIdx, c0Index/g, 'barsSinceBreakout, barsSinceRetest, undefined, spot - lvl, breakCandleIndex, retestCandleIndex, confirmationCandleIndex');
  
  // also change condition check
  funcBody = funcBody.replace(/if \(barsSinceBreak >= 1 && barsSinceBreak <= 4 && barsSinceRetest >= 1 && barsSinceRetest <= 4\)/g, 'if (barsSinceBreakout >= 1 && barsSinceBreakout <= 4 && barsSinceRetest >= 1 && barsSinceRetest <= 4)');
  funcBody = funcBody.replace(/if \(barsSinceBreak >= 1 && barsSinceBreak <= 3 && barsSinceRetest >= 1 && barsSinceRetest <= 3\)/g, 'if (barsSinceBreakout >= 1 && barsSinceBreakout <= 3 && barsSinceRetest >= 1 && barsSinceRetest <= 3)');

  code = code.substring(0, startIndex) + funcBody + code.substring(endIndex);
}

patchFunction('checkFailedRetest');
patchFunction('checkOpeningTrap');

fs.writeFileSync('src/backend/strategy-engine.ts', code);
