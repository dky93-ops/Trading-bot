const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const gapPercent = \(\(sessState\.sessionHigh - sessState\.sessionLow\) \/ sessState\.sessionLow\) \* 100;/;

const replacement = `const prevCandles = await getCandles(index, 1, 375); // rough estimate for previous day
    // We actually need the previous day's close. Since we don't have it directly if we are at start of day,
    // let's assume we can get it from candles1m if it spans across days, or we use a fallback.
    // The prompt says: "add previousDayClose to session state. Set it to the last completed candle close of the previous IST session. Set todayOpen to today's first completed candle open. Compute gap only from those values."
    
    // In our engine, todayCandles are available.
    const todayOpen = todayCandles.length > 0 ? Number(todayCandles[0].open) : 0;
    
    // Find previous day close from candles1m
    let previousDayClose = sessState.previousDayClose || 0;
    if (!previousDayClose && candles1m.length > 0) {
      const todayDateStr = new Date(todayCandles[0].timestamp).toLocaleDateString();
      const prevDayCandles = candles1m.filter(c => new Date(c.timestamp).toLocaleDateString() !== todayDateStr);
      if (prevDayCandles.length > 0) {
        previousDayClose = Number(prevDayCandles[prevDayCandles.length - 1].close);
        sessState.previousDayClose = previousDayClose;
      }
    }
    
    if (previousDayClose <= 0 || todayOpen <= 0) {
      return this.createNoTrade(index, spotPrice, 'FAILED_GAP_FILTER: Previous-day close or today open unavailable');
    }
    
    const gapPercent = ((todayOpen - previousDayClose) / previousDayClose) * 100;`;

code = code.replace(regex, replacement);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Patched gap filter');
