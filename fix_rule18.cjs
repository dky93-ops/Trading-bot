const fs = require('fs');
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule18BrokenLevelReclaimedInvalidation\([\s\S]*?return pass\(\);\n\}/;
const replace = `export function rule18BrokenLevelReclaimedInvalidation(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const candles = ctx.candles1m;
  if (!candles || candles.length < 3 || !setup.level) return pass();
  
  let reclaimed = false;
  let breakoutIdx = -1;
  
  if (setup.direction === 'CALL') {
    for (let i = candles.length - 1; i >= Math.max(1, candles.length - 15); i--) {
      if (candles[i].close > setup.level && candles[i - 1].close <= setup.level) {
        breakoutIdx = i;
        break;
      }
    }
    if (breakoutIdx !== -1) {
      for (let j = breakoutIdx + 1; j < candles.length; j++) {
        if (candles[j].close < setup.level) {
          reclaimed = true;
          break;
        }
      }
    }
  } else {
    for (let i = candles.length - 1; i >= Math.max(1, candles.length - 15); i--) {
      if (candles[i].close < setup.level && candles[i - 1].close >= setup.level) {
        breakoutIdx = i;
        break;
      }
    }
    if (breakoutIdx !== -1) {
      for (let j = breakoutIdx + 1; j < candles.length; j++) {
        if (candles[j].close > setup.level) {
          reclaimed = true;
          break;
        }
      }
    }
  }
  
  if (reclaimed) {
    return fail('FAILED_RECLAIM: Broken level was reclaimed by a closed candle');
  }
  return pass();
}`;

rules = rules.replace(regex, replace);
fs.writeFileSync('src/backend/validation-rules.ts', rules);
