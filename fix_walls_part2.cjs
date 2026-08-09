const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

engine = engine.replace(
  /const snapshotKey = candles1m\.length > 0 \? new Date\(candles1m\[candles1m\.length - 1\]\.timestamp\)\.toISOString\(\) : '';\s*const \{ wallsAbove, wallsBelow, rawWallsAbove, rawWallsBelow \} = this\.findValidOIWalls\(chainRows, spotPrice, step, sessState, snapshotKey\);\s*const nearestCeWallAbove = wallsAbove\.length > 0 \? wallsAbove\[0\]\.strike : 0;\s*const nearestPeWallBelow = wallsBelow\.length > 0 \? wallsBelow\[0\]\.strike : 0;/,
  `const snapshotKey = candles1m.length > 0 ? new Date(candles1m[candles1m.length - 1].timestamp).toISOString() : '';
    const candidates = this.findCandidateOIWalls(chainRows, spotPrice, sessState, snapshotKey);
    this.recordWallReactions(candidates, todayCandles, step, sessState);
    const { wallsAbove, wallsBelow } = this.getValidatedOIWalls(candidates, sessState);
    const nearestCeWallAbove = wallsAbove.length > 0 ? wallsAbove[0].strike : 0;
    const nearestPeWallBelow = wallsBelow.length > 0 ? wallsBelow[0].strike : 0;`
);

engine = engine.replace(
  /\/\/ Track wall reaction counts\s*this\.updateWallTestCounts\(spotPrice, step, sessState, todayCandles, rawWallsAbove \|\| \[\], rawWallsBelow \|\| \[\]\);/,
  "// Wall reactions already recorded"
);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
