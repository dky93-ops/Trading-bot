const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

// RULE 18 patch
code = code.replace(
  "return fail('FAILED_RECLAIMED_LEVEL: Insufficient candles to determine reclaim');",
  "return fail('FAILED_HISTORY: Insufficient candles to determine reclaim');"
);

// RULE 2 patch
const r2Old = `// RULE 2
export function rule2OpeningFilter(timeStr: string, setup?: ProposedSetup): RuleResult {
  if (timeStr < '09:15') return fail('FAILED_TIME_FILTER: Pre-market');
  if (timeStr >= '15:30') return fail('FAILED_TIME_FILTER: Post-market');
  if (timeStr < '09:20' && !setup) {
    // Soft gate: don't block pre-checks, but require full setup confirmation
    return pass(); 
  }
  if (timeStr < '09:20' && setup) {
    // Exceptional clarity required
    if (!setup.c0 || !setup.c1) return fail('FAILED_TIME_FILTER: Pre-09:20 requires exceptional clarity (missing candles)');
  }
  return pass();
}`;

const r2New = `// RULE 2
export function rule2OpeningFilter(timeStr: string, setup?: ProposedSetup): RuleResult {
  if (timeStr < '09:15') return fail('FAILED_TIME_FILTER: Pre-market');
  if (timeStr >= '15:30') return fail('FAILED_TIME_FILTER: Post-market');
  
  if (setup) {
    if (timeStr < '09:20') {
      if (!setup.c0 || !setup.c1 || !setup.c2) return fail('FAILED_TIME_FILTER: Pre-09:20 requires exceptional clarity and full confirmation');
    } else if (timeStr < '09:30') {
      if (!setup.c0 || !setup.c1) return fail('FAILED_TIME_FILTER: 09:20-09:30 requires genuinely strong fully confirmed setup');
    }
  }
  return pass();
}`;

if (code.includes(r2Old)) {
  code = code.replace(r2Old, r2New);
} else {
  console.log("Could not find old rule2");
}

fs.writeFileSync('src/backend/validation-rules.ts', code);
