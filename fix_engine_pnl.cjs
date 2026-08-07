const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/public activeSignals = new Map\<string, InternalSignal\>\(\);/g, 
`public activeSignals = new Map<string, InternalSignal>();
  public overallPnL: number = 0;
  public realizedPnL: number = 0;
  public unrealizedPnL: number = 0;
  public winRate: number = 0;
  public totalTrades: number = 0;
  public winningTrades: number = 0;`);

code = code.replace(/signal\.realizedPnL = \(exitPrice - signal\.entryPrice\) \* qty;/g,
`signal.realizedPnL = (exitPrice - signal.entryPrice) * qty;
    this.realizedPnL += signal.realizedPnL;
    this.totalTrades += 1;
    if (signal.realizedPnL > 0) this.winningTrades += 1;
    this.winRate = this.totalTrades > 0 ? (this.winningTrades / this.totalTrades) * 100 : 0;`);

// In `onTick`, we must calculate unrealized PnL
code = code.replace(/newSignals\.forEach\(s =\> this\.activeSignals\.set\(s\.id, s\)\);/g,
`newSignals.forEach(s => this.activeSignals.set(s.id, s));
    
    // Calculate unrealized PnL
    this.unrealizedPnL = 0;
    for (const sig of this.activeSignals.values()) {
      const curPrice = sig.latestPrice || sig.entryPrice;
      const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
      const lotConfig = (this.settings.strategies as any)[stratKey]?.lotSize || this.settings.defaultLotsPerTrade || 1;
      const qty = 75 * lotConfig;
      this.unrealizedPnL += (curPrice - sig.entryPrice) * qty;
    }
    this.overallPnL = this.realizedPnL + this.unrealizedPnL;`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
