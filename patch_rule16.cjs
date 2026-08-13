const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule16RoomToTarget[\s\S]*?return pass\(\);\n\}/m;

const replacement = `export function rule16RoomToTarget(setup: ProposedSetup): RuleResult {
  if (!setup.target1 || setup.target1 <= 0 || !setup.stopLoss || setup.stopLoss <= 0 || !setup.c0) return fail('FAILED_ROOM_TO_TARGET: Missing target, stopLoss, or candle data');
  const riskSpot = Math.abs(setup.c0.close - setup.stopLoss);
  const rewardSpot = setup.direction === 'CALL'
    ? setup.target1 - setup.c0.close
    : setup.c0.close - setup.target1;
  if (!(riskSpot > 0) || rewardSpot / riskSpot < 0.8) {
    return fail('FAILED_ROOM_TO_TARGET: Target 1 is less than 0.8R');
  }
  return pass();
}`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('Patched rule16');
