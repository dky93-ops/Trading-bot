const fs = require('fs');

let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule18BrokenLevelReclaimedInvalidation\([\s\S]*?\n\s*return success\('Broken level holds'\);\n\}/m;

const replacement = `export function rule18BrokenLevelReclaimedInvalidation(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const breakIdx = setup.breakCandleIndex;
  if (breakIdx !== undefined) {
    const nextCandle = ctx.candles1m[breakIdx + 1];
    if (nextCandle) {
       if (setup.direction === 'CALL' && nextCandle.close < setup.level) {
         return fail('FAILED_RECLAIM: Broken level was reclaimed by the next candle');
       }
       if (setup.direction === 'PUT' && nextCandle.close > setup.level) {
         return fail('FAILED_RECLAIM: Broken level was reclaimed by the next candle');
       }
    }
  }
  return success('Broken level holds');
}`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('PATCH 6 rule18 complete');
