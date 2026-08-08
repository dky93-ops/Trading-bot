const fs = require('fs');

let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

// Update runGlobalPreChecks
const runGlobalPreChecksRegex = /export function runGlobalPreChecks[\s\S]*?return pass\(\);\n\}/;
const runGlobalPreChecksNew = `export function runGlobalPreChecks(ctx: ValidationContext): RuleResult {
  const checks = [
    rule1CompletedCandles(ctx.candles1m, ctx.timeObj),
    rule2OpeningFilter(ctx.timeStr),
    rule3OneOpenTrade(ctx.activeSignals),
    rule4Cooldown(ctx.sessState, ctx.timeObj.getTime())
  ];
  for (const check of checks) {
    if (!check.passed) return check;
  }
  return pass();
}`;
rules = rules.replace(runGlobalPreChecksRegex, runGlobalPreChecksNew);

// Actually, wait, rule2OpeningFilter is currently handling BOTH market hours and setup.
// I need to split it, as in the previous fix that failed.
