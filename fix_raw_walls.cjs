const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// First, modify findValidOIWalls to return raw walls as well
engine = engine.replace(/return \{ wallsAbove, wallsBelow \};/, 'return { wallsAbove, wallsBelow, rawWallsAbove, rawWallsBelow };');

// Second, modify the call site in evaluateIndex
engine = engine.replace(/const snapshotKey = candles1m\.length > 0 \? new Date\(candles1m\[candles1m\.length - 1\]\.timestamp\)\.toISOString\(\) : '';\n    const \{ wallsAbove, wallsBelow \} = this\.findValidOIWalls\(chainRows, spotPrice, step, sessState, snapshotKey\);/,
  "const snapshotKey = candles1m.length > 0 ? new Date(candles1m[candles1m.length - 1].timestamp).toISOString() : '';\n    const { wallsAbove, wallsBelow, rawWallsAbove, rawWallsBelow } = this.findValidOIWalls(chainRows, spotPrice, step, sessState, snapshotKey);"
);

// Third, pass raw walls to updateWallTestCounts
engine = engine.replace(/this\.updateWallTestCounts\(spotPrice, step, sessState, todayCandles, wallsAbove, wallsBelow\);/,
  "this.updateWallTestCounts(spotPrice, step, sessState, todayCandles, rawWallsAbove || [], rawWallsBelow || []);"
);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
