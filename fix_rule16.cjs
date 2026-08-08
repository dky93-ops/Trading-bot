const fs = require('fs');
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule16RoomToTarget\([\s\S]*?return pass\(\);\n\}/;

const replacement = `export function rule16RoomToTarget(setup: ProposedSetup): RuleResult {
  if (!setup.target1 || setup.target1 <= 0 || !setup.stopLoss || setup.stopLoss <= 0 || !setup.level || setup.level <= 0) return fail('FAILED_ROOM_TO_TARGET: Missing target, stopLoss, or level data');
  const risk = Math.abs(setup.level - setup.stopLoss);
  const reward1 = Math.abs(setup.target1 - setup.level);
  if (risk > 0 && (reward1 / risk) < 0.8) return fail('FAILED_ROOM_TO_TARGET: Target 1 is less than 0.8R');
  return pass();
}`;

rules = rules.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', rules);
