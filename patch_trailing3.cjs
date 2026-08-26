const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

code = code.replace(
  "if (cTime >= signal.entryTime && candles[i-1].low < candles[i-2].low && candles[i-1].low < candles[i].low) {",
  "if (cTime >= entryTime && candles[i-1].low < candles[i-2].low && candles[i-1].low < candles[i].low) {"
);

code = code.replace(
  "if (cTime >= signal.entryTime && candles[i-1].high > candles[i-2].high && candles[i-1].high > candles[i].high) {",
  "if (cTime >= entryTime && candles[i-1].high > candles[i-2].high && candles[i-1].high > candles[i].high) {"
);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
