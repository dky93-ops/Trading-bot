const fs = require('fs');

let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex19 = /export function rule19OverallAgreement\([\s\S]*?return pass\(\);\n\}/;

const newRule19 = `export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  
  // Direction and spot structure agreement
  if (isCall && setup.c0.close < setup.level) return fail('FAILED_OVERALL_AGREEMENT: CALL setup requires spot above level');
  if (!isCall && setup.c0.close > setup.level) return fail('FAILED_OVERALL_AGREEMENT: PUT setup requires spot below level');

  // Premium agreement
  const opt = isCall ? setup.ceOpt : setup.peOpt;
  if (!opt || !opt.price || opt.price <= 0) return fail('FAILED_OVERALL_AGREEMENT: Missing premium data');

  // Reward/Risk
  const entry = setup.c0.close;
  const risk = isCall ? entry - setup.stopLoss : setup.stopLoss - entry;
  const reward1 = isCall ? setup.target1 - entry : entry - setup.target1;
  if (risk > 0 && reward1 / risk < 0.8) return fail('FAILED_OVERALL_AGREEMENT: Target 1 is less than 0.8R');

  // Family-specific timing and sequence
  if (['FAILED_RETEST', 'OPENING_TRAP'].includes(setup.setupType)) {
    if (setup.breakCandleIndex === undefined || setup.retestCandleIndex === undefined || setup.confirmationCandleIndex === undefined) {
      return fail('FAILED_OVERALL_AGREEMENT: Missing sequence indices for retest family');
    }
    if (setup.barsSinceBreakout === undefined || setup.barsSinceRetest === undefined) {
      return fail('FAILED_OVERALL_AGREEMENT: Missing bar counts for retest family');
    }
    if (setup.setupType === 'FAILED_RETEST' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 4)) {
      return fail('FAILED_OVERALL_AGREEMENT: FAILED_RETEST requires 1-4 retest candles');
    }
    if (setup.setupType === 'OPENING_TRAP' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 3)) {
      return fail('FAILED_OVERALL_AGREEMENT: OPENING_TRAP requires 1-3 retest candles');
    }
  }

  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN') {
    if (setup.setupType === 'CONTINUATION_BREAKOUT' && !isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakout must be CALL');
    if (setup.setupType === 'CONTINUATION_BREAKDOWN' && isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakdown must be PUT');
    if (setup.barsSinceBreakout === undefined || setup.barsSinceBreakout < 1) return fail('FAILED_OVERALL_AGREEMENT: Continuation requires valid pause');
  }

  if (setup.setupType === 'OI_WALL_REJECTION') {
    const wallTests = ctx.sessState.wallTestCounts[setup.level] || 0;
    if (wallTests < 2) return fail('FAILED_OVERALL_AGREEMENT: OI Wall Rejection requires at least 2 distinct wall tests');
    
    const reactionKeys = ctx.sessState.wallReactionCandleKeys[setup.level] || [];
    if (reactionKeys.length < 1) return fail('FAILED_OVERALL_AGREEMENT: OI Wall Rejection requires at least 1 session reaction');
    
    if (!ctx.sessState.wallOIWeakeningConfirmed[setup.level]) return fail('FAILED_OVERALL_AGREEMENT: Wall weakening not confirmed');
    if (!setup.premiumAtConfirmation) return fail('FAILED_OVERALL_AGREEMENT: Premium confirmation missing for Wall Rejection');
  }

  // Reclaim Invalidation logic check is done by rule18, but enforce sequence here too if needed
  if (ctx.sessState.lastConfirmedReclaimLevel === setup.level) {
    return fail('FAILED_OVERALL_AGREEMENT: Level was reclaimed');
  }

  return pass();
}`;

rules = rules.replace(regex19, newRule19);

fs.writeFileSync('src/backend/validation-rules.ts', rules);
