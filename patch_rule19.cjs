const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule19OverallAgreement[\s\S]*?return pass\(\);\n\}/m;

const replacement = `export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  
  if (isCall && setup.c0.close < setup.level) return fail('FAILED_OVERALL_AGREEMENT: CALL setup requires spot above level');
  if (!isCall && setup.c0.close > setup.level) return fail('FAILED_OVERALL_AGREEMENT: PUT setup requires spot below level');
  
  if (setup.setupType === 'OI_WALL_REJECTION' && (setup as any).wallStable !== true) {
    return fail('FAILED_OVERALL_AGREEMENT: Wall is not stable/dominant');
  }

  return pass();
}`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('Patched rule19');
