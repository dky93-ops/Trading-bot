const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

// RULE 14
const oldR14 = `// RULE 14
export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  const spotMoveFromLevel = setup.spotMoveFromLevel;
  const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (spotMoveFromLevel === undefined) return fail('FAILED_MIXED_DIRECTION: Missing spot structure data');
  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) return fail('FAILED_MIXED_DIRECTION: Missing premium series data');
  
  const [p1, p2, p3] = premiumSeriesLast3;
  const premiumConfirming = p3 >= p1;
  
  if (setup.direction === 'CALL') {
    if (spotMoveFromLevel <= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bullish');
    if (!premiumConfirming) return fail('FAILED_MIXED_DIRECTION: CE Premium not confirming');
  } else {
    if (spotMoveFromLevel >= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bearish');
    if (!premiumConfirming) return fail('FAILED_MIXED_DIRECTION: PE Premium not confirming');
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

code = code.replace(oldR14, newR14);

// RULE 12
const oldR12 = `// RULE 12
export function rule12ConfirmationCandle(setup: ProposedSetup, index: string): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  const minBody = index === 'NIFTY' ? 0.5 : 1; 
  if (isCall && c0.close <= c0.open + minBody) return fail('FAILED_CONFIRMATION_CANDLE: Candle is not solidly GREEN');
  if (!isCall && c0.close >= c0.open - minBody) return fail('FAILED_CONFIRMATION_CANDLE: Candle is not solidly RED');
  return pass();
}`;

const newR12 = `// RULE 12
export function rule12ConfirmationCandle(setup: ProposedSetup, index: string): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  // Use a smaller, prompt-aligned confirmation threshold
  const minBody = index === 'NIFTY' ? 0.1 : 0.2; 
  if (isCall && c0.close <= c0.open + minBody) return fail('FAILED_CONFIRMATION_CANDLE: Candle is not confirming GREEN');
  if (!isCall && c0.close >= c0.open - minBody) return fail('FAILED_CONFIRMATION_CANDLE: Candle is not confirming RED');
  return pass();
}`;

code = code.replace(oldR12, newR12);

// RULE 19
const oldR19 = `// RULE 19
export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const spotMove = setup.spotMoveFromLevel || 0;
  
  if (isCall && spotMove < 0) return fail('FAILED_OVERALL_AGREEMENT: CALL signal but spot structure is bearish');
  if (!isCall && spotMove > 0) return fail('FAILED_OVERALL_AGREEMENT: PUT signal but spot structure is bullish');

  const premiumLast3 = isCall ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (premiumLast3 && premiumLast3.length === 3) {
    const [p1, p2, p3] = premiumLast3;
    if (p3 < p1) return fail('FAILED_OVERALL_AGREEMENT: Premium series is moving against the intended direction');
  }
  
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
    // For both CALL (CE) and PUT (PE), premium must go up
    if (p3 < p1) return fail('FAILED_OVERALL_AGREEMENT: Premium series is moving against the intended direction');
  }
  
  // Cross check families
  if (setup.setupType === 'CONTINUATION_BREAKOUT' && !isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakout must be CALL');
  if (setup.setupType === 'CONTINUATION_BREAKDOWN' && isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakdown must be PUT');
  
  return pass();
}`;

code = code.replace(oldR19, newR19);

// RULE 10
const oldR10 = `// RULE 10
export function rule10BreakoutConfirmation(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST') {
    if (!setup.c2 || !setup.c1 || !setup.c0) return fail('FAILED_BREAKOUT_CONF: Required candles missing');

    if (setup.direction === 'CALL') {
      if (!(setup.c2.close > setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not > level');
      if (!(setup.c0.close > Math.max(setup.c1.high, setup.level))) return fail('FAILED_BREAKOUT_CONF: c0.close not confirming breakout');
      if (!(setup.c0.close > setup.c0.open)) return fail('FAILED_BREAKOUT_CONF: c0 is not green');
    } else {
      if (!(setup.c2.close < setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not < level');
      if (!(setup.c0.close < Math.min(setup.c1.low, setup.level))) return fail('FAILED_BREAKOUT_CONF: c0.close not confirming breakdown');
      if (!(setup.c0.close < setup.c0.open)) return fail('FAILED_BREAKOUT_CONF: c0 is not red');
    }
  }
  return pass();
}`;

const newR10 = `// RULE 10
export function rule10BreakoutConfirmation(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST') {
    if (!setup.c2 || !setup.c1 || !setup.c0) return fail('FAILED_BREAKOUT_CONF: Required candles missing');

    if (setup.direction === 'CALL') {
      if (!(setup.c2.close > setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not > level');
      if (!(setup.c0.close > setup.level)) return fail('FAILED_BREAKOUT_CONF: c0.close not confirming breakout');
      if (!(setup.c0.close > setup.c0.open)) return fail('FAILED_BREAKOUT_CONF: c0 is not green');
    } else {
      if (!(setup.c2.close < setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not < level');
      if (!(setup.c0.close < setup.level)) return fail('FAILED_BREAKOUT_CONF: c0.close not confirming breakdown');
      if (!(setup.c0.close < setup.c0.open)) return fail('FAILED_BREAKOUT_CONF: c0 is not red');
    }
  }
  return pass();
}`;

code = code.replace(oldR10, newR10);

fs.writeFileSync('src/backend/validation-rules.ts', code);
