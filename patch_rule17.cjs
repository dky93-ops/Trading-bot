const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

// import computeATR
if (!code.includes('computeATR')) {
    code = code.replace("import { StrategySessionState, Candle, InternalSignal } from './types.js';",
    "import { StrategySessionState, Candle, InternalSignal } from './types.js';\nimport { computeATR } from './technical-indicators';");
}

const oldRule = `export function rule17ChopZoneFilter(ctx: ValidationContext): RuleResult {
  const last20 = ctx.candles1m.slice(-20);
  if (last20.length === 20) {
    const high20 = Math.max(...last20.map(c => c.high));
    const low20 = Math.min(...last20.map(c => c.low));
    if (high20 - low20 < 40) {
      return fail('FAILED_CHOP_ZONE: 20-candle range < 40 points');
    }
  }
  return pass();
}`;

const newRule = `export function rule17ChopZoneFilter(ctx: ValidationContext): RuleResult {
  const atrPeriod = ctx.settings?.CHOP_ATR_PERIOD || 14;
  const atrMultiplier = ctx.settings?.CHOP_ATR_MULTIPLIER || 1.5;
  const candles = ctx.candles1m;

  if (candles.length >= atrPeriod) {
    const atrArray = computeATR(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      candles.map((c) => c.close),
      atrPeriod
    );
    const currentAtr = atrArray[atrArray.length - 1];

    if (!isNaN(currentAtr)) {
      const minRange = currentAtr * atrMultiplier;
      const last20 = candles.slice(-20);
      if (last20.length === 20) {
        const high20 = Math.max(...last20.map((c) => c.high));
        const low20 = Math.min(...last20.map((c) => c.low));
        if (high20 - low20 < minRange) {
          return fail(\`FAILED_CHOP_ZONE: 20-candle range < ATR-based floor (\${minRange.toFixed(2)} points)\`);
        }
      }
    }
  }
  return pass();
}`;

code = code.replace(oldRule, newRule);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('patched rule17');
