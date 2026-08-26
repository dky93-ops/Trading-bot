const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

const oldTrailing = `      const optionRisk = signal.optionEntry - signal.optionStoploss;
      if (
        signal.firstTargetHitFlag &&
        optionRisk > 0 &&
        signal.highestPrice > signal.optionEntry
      ) {
        const candidate = Number(
          (signal.highestPrice - optionRisk * 0.5).toFixed(2),
        );
        if (candidate > signal.optionStoploss) {
          signal.optionStoploss = candidate;
          signal.stoploss = candidate;
        }
      }`;

const newTrailing = `      const optionRisk = signal.optionEntry - signal.optionStoploss;
      if (signal.firstTargetHitFlag && optionRisk > 0) {
         // 5. Market Structure (Swing) Trailing Stop-Loss
         const candles = this.state.nifty50?.candles1m || [];
         if (candles.length >= 3) {
            let atrBuffer = 5;
            const atrPeriod = this.settings.CHOP_ATR_PERIOD || 14;
            const atrMultiplier = this.settings.SL_BUFFER_ATR_MULTIPLIER || 0.5;
            if (candles.length >= atrPeriod) {
               const atrArray = computeATR(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), atrPeriod);
               const currentAtr = atrArray[atrArray.length - 1];
               if (!isNaN(currentAtr)) atrBuffer = currentAtr * atrMultiplier;
            }

            // Find latest swing based on direction
            let newSpotInvalidation = signal.spotInvalidation;
            
            if (isCall) {
               // Find highest swing low
               let highestSwingLow = -Infinity;
               for (let i = 2; i < candles.length - 1; i++) {
                  if (candles[i-1].low < candles[i-2].low && candles[i-1].low < candles[i].low) {
                     highestSwingLow = Math.max(highestSwingLow, candles[i-1].low);
                  }
               }
               if (highestSwingLow !== -Infinity) {
                  const trailSpot = highestSwingLow - atrBuffer;
                  if (trailSpot > signal.spotInvalidation) {
                     signal.spotInvalidation = trailSpot;
                  }
               }
            } else {
               // Find lowest swing high
               let lowestSwingHigh = Infinity;
               for (let i = 2; i < candles.length - 1; i++) {
                  if (candles[i-1].high > candles[i-2].high && candles[i-1].high > candles[i].high) {
                     lowestSwingHigh = Math.min(lowestSwingHigh, candles[i-1].high);
                  }
               }
               if (lowestSwingHigh !== Infinity) {
                  const trailSpot = lowestSwingHigh + atrBuffer;
                  if (trailSpot < signal.spotInvalidation) {
                     signal.spotInvalidation = trailSpot;
                  }
               }
            }
         }
         
         // Still fallback trail the option premium to lock profits just in case gamma is wild
         if (signal.highestPrice > signal.optionEntry) {
            const candidate = Number((signal.highestPrice - optionRisk * 0.5).toFixed(2));
            if (candidate > signal.optionStoploss) {
               signal.optionStoploss = candidate;
               signal.stoploss = candidate;
            }
         }
      }`;

code = code.replace(oldTrailing, newTrailing);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
