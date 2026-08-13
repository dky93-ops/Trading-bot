const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex1 = /const candles1m = await getCandles\(index, 1, 60\);\n\s*if \(\!candles1m \|\| candles1m\.length === 0\) \{\n\s*return this\.createNoTrade\(index, spotPrice, 'FAILED_FEED_SYNC: No completed candles'\);\n\s*\}/m;

const replace1 = `const decisionTimeframe = this.settings.DECISION_TIMEFRAME_MINUTES || 5;
    let decisionCandles = await getCandles(index, decisionTimeframe, 200);
    decisionCandles = decisionCandles
      .slice()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const nowMs = timeObj.getTime();
    const currentBucketStart =
      Math.floor(nowMs / (decisionTimeframe * 60_000)) *
      decisionTimeframe *
      60_000;

    const candles = decisionCandles.filter((c) => {
      const startMs = new Date(c.timestamp).getTime();
      return Number.isFinite(startMs) && startMs < currentBucketStart;
    });

    const latest = candles[candles.length - 1];
    if (!latest) {
      return this.createNoTrade(index, spotPrice, 'NO_TRADE: no completed decision candle');
    }

    const latestStartMs = new Date(latest.timestamp).getTime();
    const ageMs = currentBucketStart - latestStartMs;
    if (ageMs > decisionTimeframe * 60_000 * 2) {
      return this.createNoTrade(index, spotPrice, 'NO_TRADE: decision candle is stale or an interval is missing');
    }`;

code = code.replace(regex1, replace1);

code = code.replace(/lastCompletedCandle = candles1m\[candles1m\.length - 1\];/g, "lastCompletedCandle = candles[candles.length - 1];");
code = code.replace(/const completedCandleCloseTimestamp = new Date\(lastCompletedCandle\.timestamp\)\.getTime\(\) \+ 60_000;/g, "const completedCandleCloseTimestamp = new Date(lastCompletedCandle.timestamp).getTime() + (decisionTimeframe * 60_000);");

// replace occurrences of candles1m in evaluateIndex
// Wait, the context needs to have `candles1m` assigned to `candles` because the ValidationContext still requires it
code = code.replace(/candles1m, sessState, settings: this.settings/g, "candles1m: candles, sessState, settings: this.settings");

// For checkOpeningTrap and checkOIWallRejection calls:
code = code.replace(/candles1m, rows,/g, "candles, rows,");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Patched evaluateIndex for candles');
