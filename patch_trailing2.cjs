const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

code = code.replace(
  "         const candles = this.state.nifty50?.candles1m || [];",
  "         const candles = this.state.nifty50?.candles1m || [];\n         const entryTime = signal.entryTime || (signal.latestOptionTimestamp - 100000000); // fallback"
);

code = code.replace(
  "               let highestSwingLow = -Infinity;\n               for (let i = 2; i < candles.length - 1; i++) {\n                  if (candles[i-1].low < candles[i-2].low && candles[i-1].low < candles[i].low) {",
  "               let highestSwingLow = -Infinity;\n               for (let i = 2; i < candles.length - 1; i++) {\n                  const cTime = typeof candles[i-1].timestamp === 'string' ? new Date(candles[i-1].timestamp).getTime() : candles[i-1].timestamp;\n                  if (cTime >= signal.entryTime && candles[i-1].low < candles[i-2].low && candles[i-1].low < candles[i].low) {"
);

code = code.replace(
  "               let lowestSwingHigh = Infinity;\n               for (let i = 2; i < candles.length - 1; i++) {\n                  if (candles[i-1].high > candles[i-2].high && candles[i-1].high > candles[i].high) {",
  "               let lowestSwingHigh = Infinity;\n               for (let i = 2; i < candles.length - 1; i++) {\n                  const cTime = typeof candles[i-1].timestamp === 'string' ? new Date(candles[i-1].timestamp).getTime() : candles[i-1].timestamp;\n                  if (cTime >= signal.entryTime && candles[i-1].high > candles[i-2].high && candles[i-1].high > candles[i].high) {"
);

// We need to add entryTime to createSignal
code = code.replace(
  "      latestOptionTimestamp: Date.now()\n    } as any;",
  "      latestOptionTimestamp: Date.now(),\n      entryTime: Date.now()\n    } as any;"
);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
