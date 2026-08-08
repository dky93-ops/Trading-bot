const fs = require('fs');

// 1. validation-rules.ts
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

// Replace rule2
const rule2Regex = /\/\/ RULE 2[\s\S]*?export function rule2OpeningFilter.*?return pass\(\);\n\}/;
const rule2New = `// RULE 2 (Market Hours Precheck)
export function rule2MarketHours(timeStr: string): RuleResult {
  if (timeStr < '09:15') return fail('FAILED_TIME_FILTER: Pre-market');
  if (timeStr >= '15:30') return fail('FAILED_TIME_FILTER: Post-market');
  return pass();
}

// RULE 2 (Setup-Specific)
export function rule2OpeningFilter(timeStr: string, setup: ProposedSetup): RuleResult {
  if (timeStr < '09:20') {
    if (!setup.c0 || !setup.c1 || !setup.c2) return fail('FAILED_TIME_FILTER: Pre-09:20 requires exceptional clarity and full confirmation');
  } else if (timeStr < '09:30') {
    if (!setup.c0 || !setup.c1) return fail('FAILED_TIME_FILTER: 09:20-09:30 requires genuinely strong fully confirmed setup');
  }
  return pass();
}`;
if (rules.match(rule2Regex)) {
    rules = rules.replace(rule2Regex, rule2New);
} else {
    console.log("Could not find rule2 to replace");
}

// Use the new global precheck
rules = rules.replace(/rule2OpeningFilter\(ctx\.timeStr\)/g, 'rule2MarketHours(ctx.timeStr)');

fs.writeFileSync('src/backend/validation-rules.ts', rules);

// 2. strategy-engine.ts
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Remove fabricated wall targets
engine = engine.replace(/wallAbove \+ 50/g, '0');
engine = engine.replace(/wallBelow - 50/g, '0');

// Remove the poisoning of failedLevelsToday and lastFailedSetupLevel on normal validation failures
engine = engine.replace(/localSess\.failedLevelsToday\.push\(setup\.level\);/g, '// REMOVED: Do not poison level on validation failure');
engine = engine.replace(/localSess\.lastFailedSetupLevel = setup\.level;/g, '// REMOVED: Do not poison level on validation failure');

// Add createNoTrade and fix evaluateIndex null returns
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
    engine = engine.replace(/public async evaluateIndex/g, createNoTradeFn + '\n\n  public async evaluateIndex');
}

engine = engine.replace(/if \(candles1m\.length === 0\) return null;/g, `if (candles1m.length === 0) return this.createNoTrade(index, spotPrice, 'No candles available');`);

engine = engine.replace(/if \(!globalPreCheckResult\.passed\) \{\s*console\.log\([^)]+\);\s*return null;\s*\}/g, `if (!globalPreCheckResult.passed) {
      console.log(\`[GLOBAL RULES] InternalSignal Rejected: \${globalPreCheckResult.reason}\`);
      return this.createNoTrade(index, spotPrice, globalPreCheckResult.reason);
    }`);

engine = engine.replace(/if \(sessState\.lastTradeCandleTime && c0TimeStr === sessState\.lastTradeCandleTime\) \{\s*failedFilters\.push[^;]+;\s*return null;\s*\}/g, `if (sessState.lastTradeCandleTime && c0TimeStr === sessState.lastTradeCandleTime) {
      const reason = \`Setup already evaluated and traded on candle timestamp \${c0TimeStr}. Waiting for next completed candle.\`;
      failedFilters.push(reason);
      return this.createNoTrade(index, spotPrice, reason);
    }`);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
