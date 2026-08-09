const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Add wallLastProcessedSnapshotKey to state
engine = engine.replace(/wallLastSeenOI: Record<number, number>;/g, "wallLastSeenOI: Record<number, number>;\n  wallLastProcessedSnapshotKey: Record<number, string>;");
engine = engine.replace(/wallLastSeenOI: \{\},/g, "wallLastSeenOI: {},\n      wallLastProcessedSnapshotKey: {},");

const regexUpdateWall = /private updateWallTestCounts\([\s\S]*?sess\.wallLastSeenOI\[wall\.strike\] = currentOI;\s*\n\s*\}/;
// Actually just replace the whole function updateWallTestCounts
const regexUpdateWallFull = /private updateWallTestCounts\([\s\S]*?\}\s*\n\s*private/;
const newUpdateWallFull = `private updateWallTestCounts(
  spot: number,
  step: number,
  sess: LocalSessionState,
  candles: Candle[],
  wallsAbove: OIWall[],
  wallsBelow: OIWall[]
) {
  if (!candles || candles.length === 0) return;

  const c0 = candles[candles.length - 1];
  const candleKey = new Date(c0.timestamp).toISOString();
  const tolerance = step * 0.25;

  if (!sess.wallTestCandleKeys) sess.wallTestCandleKeys = {};
  if (!sess.wallReactionCandleKeys) sess.wallReactionCandleKeys = {};

  const recordWallEvent = (wall: OIWall, isAbove: boolean) => {
    const strike = wall.strike;

    if (!sess.wallTestCandleKeys[strike]) {
      sess.wallTestCandleKeys[strike] = [];
    }
    if (!sess.wallReactionCandleKeys[strike]) {
      sess.wallReactionCandleKeys[strike] = [];
    }

    const touchedAbove = isAbove
      ? c0.high >= strike - tolerance && c0.close < strike
      : c0.low <= strike + tolerance && c0.close > strike;

    if (!touchedAbove) return;

    if (!sess.wallTestCandleKeys[strike].includes(candleKey)) {
      sess.wallTestCandleKeys[strike].push(candleKey);
      sess.wallTestCounts[strike] = sess.wallTestCandleKeys[strike].length;
    }

    if (!sess.wallReactionCandleKeys[strike].includes(candleKey)) {
      sess.wallReactionCandleKeys[strike].push(candleKey);
    }
  };

  for (const wall of wallsAbove) recordWallEvent(wall, true);
  for (const wall of wallsBelow) recordWallEvent(wall, false);
}

  private`;

engine = engine.replace(regexUpdateWallFull, newUpdateWallFull);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
