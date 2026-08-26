const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

// 1. Target 2 logic
const t2Regex = /if \(currentOptPrice >= signal\.optionTarget2\) {[\s\S]*?continue;\s*}/;
code = code.replace(t2Regex, 
`if (currentOptPrice >= signal.optionTarget2) {
        signal.isParabolic = true;
      }`);

// 2. Trailing Stop logic
const trailingRegex = /\/\/ Find latest swing based on direction\s*let newSpotInvalidation = signal\.spotInvalidation;\s*if \(isCall\) {[\s\S]*?if \(trailSpot < signal\.spotInvalidation\) {\s*signal\.spotInvalidation = trailSpot;\s*}\s*}\s*}/;

const newTrailLogic = `
            let parabolicAtrBuffer = 10;
            if (candles.length >= atrPeriod) {
               const atrArray = computeATR(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), atrPeriod);
               const currentAtr = atrArray[atrArray.length - 1];
               if (!isNaN(currentAtr)) {
                   parabolicAtrBuffer = currentAtr * 1.5; // 1.5x ATR for parabolic
               }
            }

            if (isCall) {
               // A. Parabolic ATR Trail
               let parabolicStop = -Infinity;
               if (signal.isParabolic) {
                   const highestSpotSinceEntry = Math.max(...candles.filter((c) => {
                       const cTs = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
                       return cTs >= entryTime;
                   }).map((c) => c.high));
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
                   const lowestSpotSinceEntry = Math.min(...candles.filter((c) => {
                       const cTs = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
                       return cTs >= entryTime;
                   }).map((c) => c.low));
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
            }`;

code = code.replace(trailingRegex, newTrailLogic);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Patched parabolic trail regex');
