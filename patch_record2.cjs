const fs = require('fs');

let engineCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /private recordWallReactions\([\s\S]*?private getValidatedOIWalls/m;

const replacement = `private recordWallReactions(
    candidates: { candidateCEWallsList: OIWall[]; candidatePEWallsList: OIWall[] },
    candles: Candle[],
    step: number,
    sess: LocalSessionState
  ): void {
    if (!candles || candles.length === 0) return;
    const candle = candles[candles.length - 1];
    const candleKey = new Date(candle.timestamp).toISOString();
    const tolerance = step * 0.25;

    if (!sess.wallReactionCandleKeys) sess.wallReactionCandleKeys = {};
    if (!sess.wallTestCandleKeys) sess.wallTestCandleKeys = {};
    if (!sess.wallTestCounts) sess.wallTestCounts = {};

    const record = (strike: number, isReaction: boolean) => {
      if (!isReaction) return;
      
      // Wall reaction tracking
      if (!sess.wallReactionCandleKeys[strike]) {
        sess.wallReactionCandleKeys[strike] = [];
      }
      if (!sess.wallReactionCandleKeys[strike].includes(candleKey)) {
        sess.wallReactionCandleKeys[strike].push(candleKey);
      }
      
      // Wall test dedupe exactly like PDF
      if (!sess.wallTestCandleKeys[strike]) {
        sess.wallTestCandleKeys[strike] = [];
      }
      if (!sess.wallTestCandleKeys[strike].includes(candleKey)) {
        sess.wallTestCandleKeys[strike].push(candleKey);
        sess.wallTestCounts[strike] = sess.wallTestCandleKeys[strike].length;
      }
    };

    for (const wall of candidates.candidateCEWallsList) {
      const isReaction =
        candle.high >= wall.strike - tolerance &&
        candle.close < wall.strike;
      record(wall.strike, isReaction);
    }

    for (const wall of candidates.candidatePEWallsList) {
      const isReaction =
        candle.low <= wall.strike + tolerance &&
        candle.close > wall.strike;
      record(wall.strike, isReaction);
    }
  }

  private getValidatedOIWalls`;
  
engineCode = engineCode.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', engineCode);
console.log('Patch 2 applied');
