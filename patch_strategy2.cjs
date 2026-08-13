const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// 4.3 Add recordWallTests
const recordWallTestsHelpers = `
  private recordWallTests(
    walls: { candidateCEWallsList: any[]; candidatePEWallsList: any[] },
    candles: Candle[],
    sess: LocalSessionState,
    tolerance: number,
  ): void {
    const candle = candles[candles.length - 1];
    if (!candle) return;
    const candleKey = new Date(candle.timestamp).toISOString();

    const record = (wall: any, rejected: boolean) => {
      if (!rejected) return;
      const strike = Number(wall.strike);
      const keys = sess.wallTestCandleKeys[strike] || [];
      if (!keys.includes(candleKey)) {
        keys.push(candleKey);
        sess.wallTestCandleKeys[strike] = keys;
        sess.wallTestCounts[strike] = keys.length;
      }
      const reactions = sess.wallReactionCandleKeys[strike] || [];
      if (!reactions.includes(candleKey)) {
        reactions.push(candleKey);
        sess.wallReactionCandleKeys[strike] = reactions;
      }
    };

    for (const wall of walls.candidateCEWallsList) {
      record(
        wall,
        candle.high >= wall.strike - tolerance && candle.close < wall.strike,
      );
    }
    for (const wall of walls.candidatePEWallsList) {
      record(
        wall,
        candle.low <= wall.strike + tolerance && candle.close > wall.strike,
      );
    }
  }

  private validStructureLevels(sess: LocalSessionState): number[] {
    return [
      sess.previousDayHigh,
      sess.previousDayLow,
      sess.openingRangeHigh,
      sess.openingRangeLow,
      sess.nearestCeWallAbove,
      sess.nearestPeWallBelow,
    ].filter((value) => Number.isFinite(value) && value > 0);
  }
`;

code = code.replace(/export class StrategyEngine \{/, 'export class StrategyEngine {' + recordWallTestsHelpers);

const candidateWallsEndRegex = /const candidates = this\.findCandidateOIWalls\(spotPrice, rows, sessState\);\n\s*const nearestCeWallAbove = candidates\.nearestCeWallAbove;\n\s*const nearestPeWallBelow = candidates\.nearestPeWallBelow;/;

code = code.replace(candidateWallsEndRegex, `const candidates = this.findCandidateOIWalls(spotPrice, rows, sessState);
    const nearestCeWallAbove = candidates.nearestCeWallAbove;
    const nearestPeWallBelow = candidates.nearestPeWallBelow;
    this.recordWallTests(candidates, candles, sessState, this.requireWallTolerance());`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
