const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const oldLogic = `      sessState.sessionHigh = Math.max(...todayCandles.map(c => c.high));
      sessState.sessionLow = Math.min(...todayCandles.map(c => c.low));
      sessState.openingRangeHigh = sessState.sessionHigh;
      sessState.openingRangeLow = sessState.sessionLow;
    } else {
      sessState.sessionHigh = spotPrice;
      sessState.sessionLow = spotPrice;
      sessState.openingRangeHigh = spotPrice;
      sessState.openingRangeLow = spotPrice;
    }`;

const newLogic = `      sessState.sessionHigh = Math.max(...todayCandles.map(c => c.high));
      sessState.sessionLow = Math.min(...todayCandles.map(c => c.low));
      sessState.openingRangeHigh = 0;
      sessState.openingRangeLow = 0;
    } else {
      sessState.sessionHigh = spotPrice;
      sessState.sessionLow = spotPrice;
      sessState.openingRangeHigh = 0;
      sessState.openingRangeLow = 0;
    }`;

engine = engine.replace(oldLogic, newLogic);
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
