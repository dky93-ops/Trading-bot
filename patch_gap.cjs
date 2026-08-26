const fs = require('fs');

// 1. types.ts
let typesCode = fs.readFileSync('src/backend/types.ts', 'utf-8');
typesCode = typesCode.replace(
  "previousDayLow: number;",
  "previousDayLow: number;\n  previousDayClose: number;\n  isGapDay: boolean;"
);
typesCode = typesCode.replace(
  "firstTargetHitFlag?: boolean;",
  "firstTargetHitFlag?: boolean;\n  secondTargetHitFlag?: boolean;\n  isParabolic?: boolean;"
);
fs.writeFileSync('src/backend/types.ts', typesCode);

// 2. strategy-engine.ts (Session State)
let engineCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');
engineCode = engineCode.replace(
  "previousDayLow: 0,",
  "previousDayLow: 0,\n      previousDayClose: 0,\n      isGapDay: false,"
);
engineCode = engineCode.replace(
  "sess.previousDayLow = Math.min(...priorCandles.map((c) => c.low));",
  "sess.previousDayLow = Math.min(...priorCandles.map((c) => c.low));\n        sess.previousDayClose = priorCandles[priorCandles.length - 1].close;\n        sess.isGapDay = Math.abs((todayCandles[0]?.open - sess.previousDayClose) / sess.previousDayClose * 100) > 0.4;"
);
fs.writeFileSync('src/backend/strategy-engine.ts', engineCode);

console.log('patched gap state');
