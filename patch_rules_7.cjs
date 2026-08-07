const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const oldR14 = `// RULE 14
export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  const spotMoveFromLevel = setup.spotMoveFromLevel;
  const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (spotMoveFromLevel === undefined) return fail('FAILED_MIXED_DIRECTION: Missing spot structure data');
  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) return fail('FAILED_MIXED_DIRECTION: Missing premium series data');
  
  const [p1, p2, p3] = premiumSeriesLast3;
  // For both CE and PE, premium should be rising to confirm the setup
  const premiumConfirming = p3 >= p1;
  
  if (setup.direction === 'CALL') {
    if (spotMoveFromLevel <= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bullish');
    if (!premiumConfirming) return fail('FAILED_MIXED_DIRECTION: CE Premium not confirming');
  } else {
    // For PUT, spot structure is bearish (spot drops), but PE premium is bullish (goes up)
    if (spotMoveFromLevel >= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bearish');
    if (!premiumConfirming) return fail('FAILED_MIXED_DIRECTION: PE Premium not confirming (must rise for a valid PUT setup)');
  }
  return pass();
}`;

const newR14 = `// RULE 14
export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  const spotMoveFromLevel = setup.spotMoveFromLevel;
  const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (spotMoveFromLevel === undefined) return fail('FAILED_MIXED_DIRECTION: Missing spot structure data');
  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) return fail('FAILED_MIXED_DIRECTION: Missing premium series data');
  
  const [p1, p2, p3] = premiumSeriesLast3;
  // For both CE and PE, premium should be confirming (not clearly dropping)
  const premiumConfirming = p3 >= p1 * 0.95;
  
  if (setup.direction === 'CALL') {
    if (spotMoveFromLevel <= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bullish');
    if (!premiumConfirming) return fail('FAILED_MIXED_DIRECTION: CE Premium not confirming');
  } else {
    // For PUT, spot structure is bearish (spot drops), but PE premium is bullish (goes up)
    if (spotMoveFromLevel >= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bearish');
    if (!premiumConfirming) return fail('FAILED_MIXED_DIRECTION: PE Premium not confirming (must rise for a valid PUT setup)');
  }
  return pass();
}`;

code = code.replace(oldR14, newR14);

fs.writeFileSync('src/backend/validation-rules.ts', code);
