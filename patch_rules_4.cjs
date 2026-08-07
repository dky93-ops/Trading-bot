const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const oldR11 = `// RULE 11
export function rule11RetestQuality(setup: ProposedSetup): RuleResult {
  if (['FAILED_RETEST', 'OPENING_TRAP'].includes(setup.setupType)) {
    if (setup.barsSinceRetest === undefined) return fail('FAILED_RETEST_QUALITY: Missing retest sequence data');
    
    if (setup.setupType === 'OPENING_TRAP' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 3)) {
      return fail('FAILED_RETEST_QUALITY: Opening trap retest must be within 1-3 candles');
    }
    
    if (setup.setupType === 'FAILED_RETEST' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 4)) {
      return fail('FAILED_RETEST_QUALITY: Failed retest must be within 1-4 candles');
    }
  }

  if (setup.c1) {
    const c1Range = setup.c1.high - setup.c1.low;
    const c1Body = Math.abs(setup.c1.close - setup.c1.open);
    if (c1Range === 0) return fail('FAILED_RETEST_QUALITY: Zero range retest candle');
    if (c1Body / c1Range < 0.2) return fail('FAILED_RETEST_QUALITY: Shallow wick-only retest or weak candle');
    if (!setup.impulseRange) return fail('FAILED_RETEST_QUALITY: Missing impulse range for comparison');
    if (c1Range < setup.impulseRange * 0.2) return fail('FAILED_RETEST_QUALITY: Weak/indecisive retest candle');
  }
  
  return pass();
}`;

const newR11 = `// RULE 11
export function rule11RetestQuality(setup: ProposedSetup): RuleResult {
  if (['FAILED_RETEST', 'OPENING_TRAP'].includes(setup.setupType)) {
    if (setup.barsSinceRetest === undefined) return fail('FAILED_RETEST_QUALITY: Missing retest sequence data');
    
    if (setup.setupType === 'OPENING_TRAP' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 3)) {
      return fail('FAILED_RETEST_QUALITY: Opening trap retest must be within 1-3 candles');
    }
    
    if (setup.setupType === 'FAILED_RETEST' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 4)) {
      return fail('FAILED_RETEST_QUALITY: Failed retest must be within 1-4 candles');
    }
  }
  return pass();
}`;

code = code.replace(oldR11, newR11);

fs.writeFileSync('src/backend/validation-rules.ts', code);
