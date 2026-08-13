const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const chopRule = `
export function rule17ChopZoneFilter(ctx: ValidationContext): RuleResult {
  const last20 = ctx.candles1m.slice(-20);
  if (last20.length === 20) {
    const high20 = Math.max(...last20.map(c => c.high));
    const low20 = Math.min(...last20.map(c => c.low));
    if (high20 - low20 < 40) {
      return fail('FAILED_CHOP_ZONE: 20-candle range < 40 points');
    }
  }
  return success('Not in chop zone');
}
`;

code = code.replace(/export function rule18BrokenLevelReclaimedInvalidation/, chopRule + "\n$&");

// Add it to runSetupValidation array
code = code.replace(/rule16RoomToTarget\(setup\),/, "rule16RoomToTarget(setup),\n    rule17ChopZoneFilter(ctx),");

fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('PATCH 6 chop zone complete');
