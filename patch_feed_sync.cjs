const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const sessState = this\.sessionStates\[index\];/;

const replacement = `const sessState = this.sessionStates[index];
    
    // Evaluate feed sync
    const candles1m = await getCandles(index, 1, 60);
    if (!candles1m || candles1m.length === 0) {
      return this.createNoTrade(index, spotPrice, 'FAILED_FEED_SYNC: No completed candles');
    }
    const lastCompletedCandle = candles1m[candles1m.length - 1];
    const completedCandleCloseTimestamp = new Date(lastCompletedCandle.timestamp).getTime() + 60_000;
    const optionChainTimestamp = Number(this.state.optionChainTimestamp || 0);
    if (!Number.isFinite(optionChainTimestamp) || optionChainTimestamp <= 0) {
      return this.createNoTrade(index, spotPrice, 'FAILED_FEED_SYNC: Missing option-chain snapshot timestamp');
    }
    const feedDeltaMs = Math.abs(optionChainTimestamp - completedCandleCloseTimestamp);
    if (feedDeltaMs > 15_000) {
      return this.createNoTrade(index, spotPrice, \`FAILED_FEED_SYNC: Spot/option-chain delta \${feedDeltaMs}ms > 15000ms\`);
    }
    const feedSyncConfidencePenalty = feedDeltaMs > 5_000 ? 5 : 0;
    sessState.feedSyncPenalty = feedSyncConfidencePenalty;`;

code = code.replace(regex, replacement);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 1 strategy-engine complete');
