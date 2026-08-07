const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/private async evaluateIndex/g, 
`private mapToPublicDecision(sig: InternalSignal): EngineDecision {
    return {
      timestamp: sig.timestamp,
      signal: sig.signal,
      strategy_family: sig.strategy_family,
      direction: sig.direction,
      spot: sig.spot,
      broken_level: sig.broken_level,
      wall_above: sig.wall_above,
      wall_below: sig.wall_below,
      option_type: sig.option_type,
      strike: sig.strike,
      entry: sig.entry,
      stoploss: sig.stoploss,
      target1: sig.target1,
      target2: sig.target2,
      confidence: sig.confidence,
      reason: sig.reason,
      fake_signal_filters_passed: sig.fake_signal_filters_passed,
      fake_signal_filters_failed: sig.fake_signal_filters_failed
    };
  }

  private async evaluateIndex`);

code = code.replace(/Promise\<Signal \| null\>/g, "Promise<InternalSignal | null>");
code = code.replace(/Promise\<Signal \| null\>/g, "Promise<InternalSignal | null>"); // Replace all occurrences if any others

fs.writeFileSync('src/backend/strategy-engine.ts', code);
