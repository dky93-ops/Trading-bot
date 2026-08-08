const fs = require('fs');
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

engine = engine.replace('  private async evaluateIndex', createNoTradeFn + '\n\n  private async evaluateIndex');
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
