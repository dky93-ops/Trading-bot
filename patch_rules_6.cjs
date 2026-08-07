const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const oldR19 = `// RULE 19
export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const spotMove = setup.spotMoveFromLevel;
  
  if (spotMove !== undefined) {
    if (isCall && spotMove < 0) return fail('FAILED_OVERALL_AGREEMENT: CALL signal but spot structure is bearish');
    if (!isCall && spotMove > 0) return fail('FAILED_OVERALL_AGREEMENT: PUT signal but spot structure is bullish');
  }

  const premiumLast3 = isCall ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (premiumLast3 && premiumLast3.length === 3) {
    const [p1, p2, p3] = premiumLast3;
    // For both CALL (CE) and PUT (PE), premium must go up
    if (p3 < p1) return fail('FAILED_OVERALL_AGREEMENT: Premium series is moving against the intended direction');
  }
  
  // Cross check families
  if (setup.setupType === 'CONTINUATION_BREAKOUT' && !isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakout must be CALL');
  if (setup.setupType === 'CONTINUATION_BREAKDOWN' && isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakdown must be PUT');
  
  return pass();
}`;

const newR19 = `// RULE 19
export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const spotMove = setup.spotMoveFromLevel;
  
  if (spotMove !== undefined) {
    if (isCall && spotMove < 0) return fail('FAILED_OVERALL_AGREEMENT: CALL signal but spot structure is bearish');
    if (!isCall && spotMove > 0) return fail('FAILED_OVERALL_AGREEMENT: PUT signal but spot structure is bullish');
  }

  const premiumLast3 = isCall ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (premiumLast3 && premiumLast3.length === 3) {
    const [p1, p2, p3] = premiumLast3;
    // Premium must not be clearly moving against intended direction
    if (p3 < p1 * 0.9) return fail('FAILED_OVERALL_AGREEMENT: Premium series is moving against the intended direction');
  }
  
  // Cross check families
  if (setup.setupType === 'CONTINUATION_BREAKOUT' && !isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakout must be CALL');
  if (setup.setupType === 'CONTINUATION_BREAKDOWN' && isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakdown must be PUT');
  
  return pass();
}`;

code = code.replace(oldR19, newR19);

fs.writeFileSync('src/backend/validation-rules.ts', code);
