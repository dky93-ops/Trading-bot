const fs = require('fs');
let file = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

file = file.replace(
/let candles1m = await getCandles\(index, 1, 60\);\n    candles1m\.reverse\(\); \/\/ chronological order/g,
`let candles1m = await getCandles(index, 1, 60);
    candles1m.reverse(); // chronological order
    
    // STRICT RULE 1: IGNORE LIVE FORMING CANDLES
    const currentMinuteStart = Math.floor(timeObj.getTime() / 60000) * 60000;
    if (candles1m.length > 0 && new Date(candles1m[candles1m.length - 1].timestamp).getTime() >= currentMinuteStart) {
      candles1m.pop(); // Remove the incomplete live candle
    }`
);

fs.writeFileSync('src/backend/strategy-engine.ts', file);
