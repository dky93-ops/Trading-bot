const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /private manageActiveTrades[\s\S]*?\} else if \(signal\.highestPrice > signal\.entryPrice \* 1\.1\) \{\s*signal\.stoploss = signal\.entryPrice;\s*\}\s*\}\s*\}/m;

const replacement = `private manageActiveTrades(newSignals: InternalSignal[]) {
    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'CLOSED') {
        this.activeSignals.delete(id);
        continue;
      }

      const currentOptPrice = signal.latestPrice || signal.optionEntry || signal.entryPrice;
      const currentSpot = this.state.nifty50.lastPrice;

      signal.highestPrice = Math.max(signal.highestPrice || currentOptPrice, currentOptPrice);

      const isCall = signal.direction === 'CALL' || signal.signal === 'BUY_CALL';
      const pnl = currentOptPrice - (signal.optionEntry || signal.entryPrice);
      
      const hitStop =
        currentOptPrice <= (signal.prices?.optionStoploss || signal.stoploss) ||
        (isCall && currentSpot <= (signal.prices?.spotInvalidation || signal.stoploss)) ||
        (!isCall && currentSpot >= (signal.prices?.spotInvalidation || signal.stoploss));

      const hitTarget =
        currentOptPrice >= (signal.prices?.optionTarget1 || signal.target1) ||
        (isCall && currentSpot >= (signal.prices?.spotTarget1 || signal.target1)) ||
        (!isCall && currentSpot <= (signal.prices?.spotTarget1 || signal.target1));

      if (hitStop) {
        this.closeTrade(signal, currentOptPrice, 'Stop Loss Hit');
      } else if (hitTarget) {
        this.closeTrade(signal, currentOptPrice, 'Target 1 Reached');
      } else if (signal.highestPrice > (signal.optionEntry || signal.entryPrice) * 1.1) {
        if (signal.prices) {
            signal.prices.optionStoploss = signal.optionEntry;
        } else {
            signal.stoploss = signal.entryPrice;
        }
      }
    }
  }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Patched manageActiveTrades');
