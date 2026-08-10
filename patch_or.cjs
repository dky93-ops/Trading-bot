const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const replacement = `
      sessState.sessionHigh = Math.max(...todayCandles.map(c => c.high));
      sessState.sessionLow = Math.min(...todayCandles.map(c => c.low));

      const openingRangeMinutes = this.settings.OPENING_RANGE_MINUTES || 15;
      const openingRangeComplete = todayCandles.length >= openingRangeMinutes;
      sessState.openingRangeComplete = openingRangeComplete;

      if (openingRangeComplete) {
        const orbCandles = todayCandles.slice(0, openingRangeMinutes);
        sessState.openingRangeHigh = Math.max(...orbCandles.map(c => c.high));
        sessState.openingRangeLow = Math.min(...orbCandles.map(c => c.low));
      } else {
        sessState.openingRangeHigh = 0;
        sessState.openingRangeLow = 0;
      }
    } else {
      sessState.sessionHigh = spotPrice;
      sessState.sessionLow = spotPrice;
      sessState.openingRangeComplete = false;
      sessState.openingRangeHigh = 0;
      sessState.openingRangeLow = 0;
    }
`;

// regex to replace lines from `sessState.sessionHigh = Math.max(...todayCandles.map(c => c.high));` to `sessState.openingRangeLow = 0; \n    }`
const regex = /sessState\.sessionHigh = Math\.max\(\.\.\.todayCandles\.map\(c => c\.high\)\);[\s\S]*?sessState\.openingRangeLow = 0;\s*\n\s*\}/;
code = code.replace(regex, replacement.trim() + "\n");
fs.writeFileSync('src/backend/strategy-engine.ts', code);
