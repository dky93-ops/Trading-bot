const fs = require('fs');

// 1. Fix validation-rules.ts
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
rules = rules.replace(/rule2MarketHours/g, 'rule2OpeningFilter');
fs.writeFileSync('src/backend/validation-rules.ts', rules);

// 2. Fix strategy-engine.ts
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const createNoTradeFn = `  private createNoTrade(index: string, spot: number, reason: string): EngineDecision {
    return {
      timestamp: new Date().toISOString(),
      signal: 'NO_TRADE',
      strategy_family: 'NONE',
      direction: 'NONE',
      spot: spot,
      broken_level: 0,
      wall_above: 0,
      wall_below: 0,
      option_type: 'NONE',
      strike: 0,
      entry: 0,
      stoploss: 0,
      target1: 0,
      target2: 0,
      confidence: 0,
      reason: [reason],
      fake_signal_filters_passed: [],
      fake_signal_filters_failed: []
    } as any;
  }`;

if (!engine.includes('createNoTrade(')) {
    engine = engine.replace(/private async evaluateIndex/g, createNoTradeFn + '\n\n  private async evaluateIndex');
}
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
