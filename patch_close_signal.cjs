const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /private closeSignal\(signal: InternalSignal, exitPrice: number, reason: string\) \{/;
const replacement = `private closeSignal(signal: InternalSignal, exitPrice: number, reason: string) {
    const sess = this.sessionStates[signal.index || 'NIFTY'];
    if (sess) {
      sess.tradeTakenFlag = false;
      if (reason.includes("SL TRIGGERED") || reason.includes("INVALIDATION") || reason.includes("EMERGENCY")) {
        sess.last_failed_setup_level = signal.broken_level;
        sess.last_failed_setup_direction = signal.direction;
        sess.last_failed_setup_timestamp = new Date().toISOString();
        sess.consecutiveLosingTrades = (sess.consecutiveLosingTrades || 0) + 1;
        if (sess.consecutiveLosingTrades >= 2) sess.noNewTradeFlag = true;
      } else {
        sess.consecutiveLosingTrades = 0;
      }
      sess.completedTradesCount = (sess.completedTradesCount || 0) + 1;
      if (sess.completedTradesCount >= 3) sess.noNewTradeFlag = true;
      
      const pnl = exitPrice - signal.entryPrice;
      sess.realizedDailyPnL = (sess.realizedDailyPnL || 0) + pnl;
    }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
