const fs = require('fs');
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function runGlobalPreChecks[\s\S]*?return pass\(\);\n\}/;
const replacement = `export function runGlobalPreChecks(ctx: ValidationContext): RuleResult {
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

rules = rules.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', rules);
