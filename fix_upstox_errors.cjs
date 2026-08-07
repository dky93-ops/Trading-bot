const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// The block iterating over this.state.signals in handlePollError and disconnect
code = code.replace(/for \(const sig of this\.state\.signals\) \{[\s\S]*?\}\n\s*\}/g, "");
// wait, the regex might be too broad. Let's just remove the block:
// `for (const sig of this.state.signals) { if (sig.status === 'ACTIVE') { ... } }`

// Let's replace `this.state.signals.forEach` or `for (const sig of this.state.signals)` if they are modifying status

code = code.replace(/for \(const sig of this\.state\.signals\) \{[\s\S]*?if \(sig\.status === 'ACTIVE'\) \{[\s\S]*?\}\n\s*\}/g, "");
code = code.replace(/for \(const sig of this\.state\.signals\) \{[\s\S]*?if \(sig\.status === 'ACTIVE'\) \{[\s\S]*?\}\n\s*\}/g, "");
// Just in case we didn't remove all:

// Also we don't have updatePnL anymore, we removed it? No we left the call to `this.updatePnL()`. We should remove that.
code = code.replace(/this\.updatePnL\(\);/g, `
      this.state.overallPnL = this.strategyEngine.overallPnL;
      this.state.realizedPnL = this.strategyEngine.realizedPnL;
      this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
      this.state.winRate = this.strategyEngine.winRate;
      this.state.totalTrades = this.strategyEngine.totalTrades;
      this.state.winningTrades = this.strategyEngine.winningTrades;
`);

fs.writeFileSync('src/backend/upstox-service.ts', code);
