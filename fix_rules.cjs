const fs = require('fs');

let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule9WallTestedTwice[\s\S]*?if \(setup\.premiumAtConfirmation < setup\.premiumAtRetestLow \* 1\.01\) \{/m;

const replacement = `export function rule9WallTestedTwice(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'OI_WALL_REJECTION') {
    if ((setup.wallTestCount || 0) < 2) {
      return fail('FAILED_WALL_TEST_COUNT: Wall was not tested at least 2 distinct times');
    }
  }
  return pass();
}

export function rule10BreakoutConfirmation(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST' || setup.setupType === 'OPENING_TRAP') {
    if (setup.breakCandleIndex === undefined) return fail('FAILED_BREAKOUT_CONF: Missing breakout history');
  }
  return pass();
}

export function rule11RetestQuality(setup: ProposedSetup): RuleResult {
  if (['FAILED_RETEST', 'OPENING_TRAP'].includes(setup.setupType)) {
    if (setup.barsSinceRetest === undefined || setup.barsSinceBreakout === undefined) {
      return fail('FAILED_RETEST_SEQUENCE: Missing retest sequence data');
    }
    
    if (setup.setupType === 'OPENING_TRAP') {
      const barsToRetest = setup.retestCandleIndex !== undefined && setup.breakCandleIndex !== undefined ? setup.retestCandleIndex - setup.breakCandleIndex : 0;
      if (barsToRetest < 1 || barsToRetest > 3) {
        return fail('FAILED_RETEST_SEQUENCE: Opening trap retest must be within 1-3 candles');
      }
    }
    
    if (setup.setupType === 'FAILED_RETEST') {
      const barsToRetest = setup.retestCandleIndex !== undefined && setup.breakCandleIndex !== undefined ? setup.retestCandleIndex - setup.breakCandleIndex : 0;
      if (barsToRetest < 1 || barsToRetest > 4) {
        return fail('FAILED_RETEST_SEQUENCE: Failed retest must be within 1-4 candles');
      }
    }
  }
  return pass();
}

export function rule12ConfirmationCandle(setup: ProposedSetup, index: string): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  if (!c0) return fail('FAILED_CONF_CANDLE: Missing confirmation candle');

  if (isCall && c0.close <= c0.open) return fail('FAILED_CONF_CANDLE: CALL setup requires green confirmation candle');
  if (!isCall && c0.close >= c0.open) return fail('FAILED_CONF_CANDLE: PUT setup requires red confirmation candle');
  
  return pass();
}

export function rule13PremiumConfirmation(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'FAILED_RETEST') {
    if (setup.premiumAtConfirmation === undefined || setup.premiumAtRetestLow === undefined || setup.premiumAtBreak === undefined) {
      return fail('FAILED_PREMIUM_CONFIRMATION: Missing premium history');
    }
    if (setup.premiumAtConfirmation < setup.premiumAtRetestLow * 1.01) {`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('Fixed rules');
