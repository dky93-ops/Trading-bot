const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const requireWallTolerance = `
  private requireWallTolerance(): number {
    const tolerance = Number(this.settings.WALL_TOLERANCE_POINTS);
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new Error('CONFIG_ERROR: WALL_TOLERANCE_POINTS must be a positive number');
    }
    return tolerance;
  }
`;

// Insert requireWallTolerance
code = code.replace(/private createInitialSessionState/, requireWallTolerance + "\n  $&");

// Fix FAILED_RETEST and OPENING_TRAP tolerances
code = code.replace(/candles\[j\]\.low <= lvl \* 1\.0005 && candles\[j\]\.close >= lvl \* 0\.9995/g, 
  "candles[j].low <= lvl + this.requireWallTolerance() && candles[j].close >= lvl - this.requireWallTolerance()");

code = code.replace(/candles\[j\]\.high >= lvl \* 0\.9995 && candles\[j\]\.close <= lvl \* 1\.0005/g,
  "candles[j].high >= lvl - this.requireWallTolerance() && candles[j].close <= lvl + this.requireWallTolerance()");

code = code.replace(/candles\[j\]\.low <= sess\.openingRangeHigh \* 1\.0005 && candles\[j\]\.close >= sess\.openingRangeHigh \* 0\.9995/g,
  "candles[j].low <= sess.openingRangeHigh + this.requireWallTolerance() && candles[j].close >= sess.openingRangeHigh - this.requireWallTolerance()");

code = code.replace(/candles\[j\]\.high >= sess\.openingRangeLow \* 0\.9995 && candles\[j\]\.close <= sess\.openingRangeLow \* 1\.0005/g,
  "candles[j].high >= sess.openingRangeLow - this.requireWallTolerance() && candles[j].close <= sess.openingRangeLow + this.requireWallTolerance()");

// Fix OI_WALL_REJECTION
code = code.replace(/c0\.high >= wallAbove \* 0\.9995 && c0\.close < wallAbove/g,
  "c0.high >= wallAbove - this.requireWallTolerance() && c0.close < wallAbove");

code = code.replace(/c0\.low <= wallBelow \* 1\.0005 && c0\.close > wallBelow/g,
  "c0.low <= wallBelow + this.requireWallTolerance() && c0.close > wallBelow");

// Fix recordWallTest / Reaction
const testRegex = /private checkOIWallReactions[\s\S]*?\n\s*\}/m;
const newReactions = `private recordWallTest(strike: number, candle: Candle, sess: LocalSessionState): void {
    const tolerance = this.requireWallTolerance();
    const candleKey = new Date(candle.timestamp).toISOString();
    const touched = candle.low <= strike + tolerance && candle.high >= strike - tolerance;
    if (!touched) return;

    if (!sess.wallTestCandleKeys[strike]) {
      sess.wallTestCandleKeys[strike] = [];
    }
    const keys = sess.wallTestCandleKeys[strike];
    if (keys.includes(candleKey)) return;

    if (keys.length > 0) {
      const previousMs = new Date(keys[keys.length - 1]).getTime();
      const currentMs = new Date(candle.timestamp).getTime();
      if (currentMs - previousMs < 120_000) return;
    }

    keys.push(candleKey);
    sess.wallTestCounts[strike] = keys.length;
  }

  private isCEResistanceRejection(strike: number, candle: Candle): boolean {
    const tolerance = this.requireWallTolerance();
    return candle.high >= strike - tolerance && candle.close < strike;
  }

  private isPESupportRejection(strike: number, candle: Candle): boolean {
    const tolerance = this.requireWallTolerance();
    return candle.low <= strike + tolerance && candle.close > strike;
  }

  private checkOIWallReactions(
    index: string,
    wallAbove: number,
    wallBelow: number,
    step: number,
    candles: Candle[],
    sess: LocalSessionState,
    chainRows?: any[]
  ): void {
    if (!candles || candles.length === 0) return;
    const candle = candles[candles.length - 1];
    
    if (!sess.wallReactionCandleKeys) sess.wallReactionCandleKeys = {};
    if (!sess.wallTestCandleKeys) sess.wallTestCandleKeys = {};
    if (!sess.wallTestCounts) sess.wallTestCounts = {};
    
    if (wallAbove > 0) {
      this.recordWallTest(wallAbove, candle, sess);
      if (this.isCEResistanceRejection(wallAbove, candle)) {
        if (!sess.wallReactionCandleKeys[wallAbove]) sess.wallReactionCandleKeys[wallAbove] = [];
        const keys = sess.wallReactionCandleKeys[wallAbove];
        const candleKey = new Date(candle.timestamp).toISOString();
        if (!keys.includes(candleKey)) keys.push(candleKey);
      }
    }
    
    if (wallBelow > 0) {
      this.recordWallTest(wallBelow, candle, sess);
      if (this.isPESupportRejection(wallBelow, candle)) {
        if (!sess.wallReactionCandleKeys[wallBelow]) sess.wallReactionCandleKeys[wallBelow] = [];
        const keys = sess.wallReactionCandleKeys[wallBelow];
        const candleKey = new Date(candle.timestamp).toISOString();
        if (!keys.includes(candleKey)) keys.push(candleKey);
      }
    }
  }`;

code = code.replace(testRegex, newReactions);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 3 tolerance/reaction complete');
