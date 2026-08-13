const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const valCtx: ValidationContext = \{[\s\S]*?chainRows: rows\n    \};/m;

const replacement = `const valCtx: any = {
      activeSignals: this.activeSignals,
      index, spotPrice, timeObj, timeStr,
      candles1m, sessState, settings: this.settings,
      chainRows: rows, nearestCeWallAbove, nearestPeWallBelow
    };`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed valCtx');
