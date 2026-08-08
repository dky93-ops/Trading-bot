const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const r19Old = `// RULE 19
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

const r19New = `// RULE 19
export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const spotMove = setup.spotMoveFromLevel;
  
  // Directional coherence
  if (spotMove !== undefined) {
    if (isCall && spotMove < 0) return fail('FAILED_OVERALL_AGREEMENT: CALL signal but spot structure is bearish');
    if (!isCall && spotMove > 0) return fail('FAILED_OVERALL_AGREEMENT: PUT signal but spot structure is bullish');
  }

  // Premium coherence
  const premiumLast3 = isCall ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (premiumLast3 && premiumLast3.length === 3) {
    const [p1, p2, p3] = premiumLast3;
    if (p3 < p1 * 0.9) return fail('FAILED_OVERALL_AGREEMENT: Premium series is moving against the intended direction');
  }
  
  // Cross check families & specific requirements
  if (setup.setupType === 'CONTINUATION_BREAKOUT' && !isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakout must be CALL');
  if (setup.setupType === 'CONTINUATION_BREAKDOWN' && isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakdown must be PUT');
  
  // Retest timing check
  if (['FAILED_RETEST', 'OPENING_TRAP'].includes(setup.setupType)) {
    if (setup.barsSinceRetest === undefined) return fail('FAILED_OVERALL_AGREEMENT: Missing retest sequence data');
    if (setup.setupType === 'OPENING_TRAP' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 3)) {
      return fail('FAILED_OVERALL_AGREEMENT: Opening trap retest must be within 1-3 candles');
    }
    if (setup.setupType === 'FAILED_RETEST' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 4)) {
      return fail('FAILED_OVERALL_AGREEMENT: Failed retest must be within 1-4 candles');
    }
  }

  // Stretched / Late setup
  if (setup.impulseRange && ctx.spotPrice) {
    const distance = Math.abs(ctx.spotPrice - setup.level);
    if (distance > 1.5 * setup.impulseRange) {
      return fail('FAILED_OVERALL_AGREEMENT: Move from breakout level > 1.5x impulse candle range');
    }
  }

  return pass();
}`;

if (code.includes(r19Old)) {
  code = code.replace(r19Old, r19New);
} else {
  console.log("Could not find old rule19");
}

fs.writeFileSync('src/backend/validation-rules.ts', code);
