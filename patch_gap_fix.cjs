const fs = require('fs');
let engineCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

engineCode = engineCode.replace(/sess\.previousDayLow = Math\.min\(\.\.\.priorCandles\.map\(\(c\) => c\.low\)\);/g, "sess.previousDayLow = Math.min(...priorCandles.map((c) => c.low));\n        sess.previousDayClose = priorCandles[priorCandles.length - 1].close;\n        if (todayCandles.length > 0) sess.isGapDay = Math.abs((todayCandles[0].open - sess.previousDayClose) / sess.previousDayClose * 100) > 0.4;");

fs.writeFileSync('src/backend/strategy-engine.ts', engineCode);
console.log('Fixed gap state');
