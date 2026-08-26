const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

let newTrailing = `
      if (currentOptPrice >= signal.optionTarget2) {
        signal.isParabolic = true;
      }

      const optionRisk = signal.optionEntry - signal.optionStoploss;
      if (signal.firstTargetHitFlag && optionRisk > 0) {
         // 5. Market Structure (Swing) Trailing Stop-Loss & Parabolic Dual-Trail
         const candles = this.state.nifty50?.candles1m || [];
         const entryTime = signal.entryTime || (signal.latestOptionTimestamp - 100000000); // fallback
         if (candles.length >= 3) {
            let atrBuffer = 5;
            let parabolicAtrBuffer = 10; // For aggressive trailing
            const atrPeriod = this.settings.CHOP_ATR_PERIOD || 14;
            const atrMultiplier = this.settings.SL_BUFFER_ATR_MULTIPLIER || 0.5;
            if (candles.length >= atrPeriod) {
               const atrArray = computeATR(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), atrPeriod);
               const currentAtr = atrArray[atrArray.length - 1];
               if (!isNaN(currentAtr)) {
                   atrBuffer = currentAtr * atrMultiplier;
                   parabolicAtrBuffer = currentAtr * 1.5; // 1.5x ATR for parabolic
               }
            }
            
            let newSpotInvalidation = signal.spotInvalidation;
            
            if (isCall) {
               // A. Parabolic ATR Trail (if triggered)
               let parabolicStop = -Infinity;
               if (signal.isParabolic) {
                   const highestSpotSinceEntry = Math.max(...candles.filter((c: any) => {
                       const cTs = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
                       return cTs >= entryTime;
                   }).map((c: any) => c.high));
                   parabolicStop = highestSpotSinceEntry - parabolicAtrBuffer;
               }

               // B. Swing Low Trail
               let highestSwingLow = -Infinity;
               for (let i = 2; i < candles.length - 1; i++) {
                  const cTime = typeof candles[i-1].timestamp === 'string' ? new Date(candles[i-1].timestamp).getTime() : candles[i-1].timestamp;
                  if (cTime >= entryTime && candles[i-1].low < candles[i-2].low && candles[i-1].low < candles[i].low) {
                     highestSwingLow = Math.max(highestSwingLow, candles[i-1].low);
                  }
               }
               
               let swingStop = -Infinity;
               if (highestSwingLow !== -Infinity) {
                  swingStop = highestSwingLow - atrBuffer;
               }

               const bestStop = Math.max(swingStop, parabolicStop, signal.spotInvalidation);
               if (bestStop > signal.spotInvalidation) {
                   signal.spotInvalidation = bestStop;
               }
            } else {
               // A. Parabolic ATR Trail
               let parabolicStop = Infinity;
               if (signal.isParabolic) {
                   const lowestSpotSinceEntry = Math.min(...candles.filter((c: any) => {
                       const cTs = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
                       return cTs >= entryTime;
                   }).map((c: any) => c.low));
                   parabolicStop = lowestSpotSinceEntry + parabolicAtrBuffer;
               }

               // B. Swing High Trail
               let lowestSwingHigh = Infinity;
               for (let i = 2; i < candles.length - 1; i++) {
                  const cTime = typeof candles[i-1].timestamp === 'string' ? new Date(candles[i-1].timestamp).getTime() : candles[i-1].timestamp;
                  if (cTime >= entryTime && candles[i-1].high > candles[i-2].high && candles[i-1].high > candles[i].high) {
                     lowestSwingHigh = Math.min(lowestSwingHigh, candles[i-1].high);
                  }
               }
               
               let swingStop = Infinity;
               if (lowestSwingHigh !== Infinity) {
                  swingStop = lowestSwingHigh + atrBuffer;
               }

               const bestStop = Math.min(swingStop, parabolicStop, signal.spotInvalidation);
               if (bestStop < signal.spotInvalidation) {
                   signal.spotInvalidation = bestStop;
               }
            }
`;

code = code.replace(
`      if (currentOptPrice >= signal.optionTarget2) {
        this.closeSignal(signal, currentOptPrice, 'OPTION PREMIUM TARGET 2');
        newSignals.push(signal);
        continue;
      }

      const optionRisk = signal.optionEntry - signal.optionStoploss;
      if (signal.firstTargetHitFlag && optionRisk > 0) {
         // 5. Market Structure (Swing) Trailing Stop-Loss
         const candles = this.state.nifty50?.candles1m || [];
         const entryTime = signal.entryTime || (signal.latestOptionTimestamp - 100000000); // fallback
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
                  const cTime = typeof candles[i-1].timestamp === 'string' ? new Date(candles[i-1].timestamp).getTime() : candles[i-1].timestamp;
                  if (cTime >= entryTime && candles[i-1].low < candles[i-2].low && candles[i-1].low < candles[i].low) {
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
                  const cTime = typeof candles[i-1].timestamp === 'string' ? new Date(candles[i-1].timestamp).getTime() : candles[i-1].timestamp;
                  if (cTime >= entryTime && candles[i-1].high > candles[i-2].high && candles[i-1].high > candles[i].high) {
                     lowestSwingHigh = Math.min(lowestSwingHigh, candles[i-1].high);
                  }
               }
               if (lowestSwingHigh !== Infinity) {
                  const trailSpot = lowestSwingHigh + atrBuffer;
                  if (trailSpot < signal.spotInvalidation) {
                     signal.spotInvalidation = trailSpot;
                  }
               }
            }`,
  newTrailing
);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Patched parabolic trail');
