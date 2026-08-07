const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(
  "const nearestCeWallAbove = wallsAbove.length > 0 ? wallsAbove[0].strike : spotPrice + step * 4;",
  "const nearestCeWallAbove = wallsAbove.length > 0 ? wallsAbove[0].strike : 0;"
);

code = code.replace(
  "const nearestPeWallBelow = wallsBelow.length > 0 ? wallsBelow[0].strike : spotPrice - step * 4;",
  "const nearestPeWallBelow = wallsBelow.length > 0 ? wallsBelow[0].strike : 0;"
);

// updateWallTestCounts fix
const badUpdate = `  private updateWallTestCounts(spot: number, step: number, sess: LocalSessionState) {
    const roundedSpot = Math.round(spot / step) * step;
    sess.wallTestCounts[roundedSpot] = (sess.wallTestCounts[roundedSpot] || 0) + 1;
  }`;

const fixUpdate = `  private updateWallTestCounts(spot: number, step: number, sess: LocalSessionState, candles: Candle[], wallsAbove: OIWall[], wallsBelow: OIWall[]) {
    if (candles.length === 0) return;
    const c0 = candles[candles.length - 1];
    const tolerance = step * 0.25;

    for (const wall of wallsAbove) {
      if (c0.high >= wall.strike - tolerance && c0.close < wall.strike) {
        sess.wallTestCounts[wall.strike] = (sess.wallTestCounts[wall.strike] || 0) + 1;
      }
    }
    for (const wall of wallsBelow) {
      if (c0.low <= wall.strike + tolerance && c0.close > wall.strike) {
        sess.wallTestCounts[wall.strike] = (sess.wallTestCounts[wall.strike] || 0) + 1;
      }
    }
  }`;

code = code.replace(badUpdate, fixUpdate);
// Need to also replace the call site for updateWallTestCounts
code = code.replace(
  "this.updateWallTestCounts(spotPrice, step, sessState);",
  "this.updateWallTestCounts(spotPrice, step, sessState, todayCandles, wallsAbove, wallsBelow);"
);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
