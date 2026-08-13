const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule19OverallAgreement\(valCtx: ValidationContext, setup: ProposedSetup\): ValidationResult \{/;
const insert = `export function rule19OverallAgreement(valCtx: ValidationContext, setup: ProposedSetup): ValidationResult {
  const selected = setup.direction === 'CALL' ? setup.ceOpt : setup.peOpt;
  if (!selected || !(Number(selected.price) > 0)) {
    return fail('FAILED_OVERALL_AGREEMENT: selected option is unavailable');
  }

  if (
    setup.setupType !== 'OI_WALL_REJECTION' &&
    (
      setup.premiumAtBreak === undefined ||
      setup.premiumAtConfirmation === undefined
    )
  ) {
    return fail('FAILED_OVERALL_AGREEMENT: historical premium evidence missing');
  }

  if (
    setup.setupType === 'FAILED_RETEST' &&
    setup.premiumAtRetestLow === undefined
  ) {
    return fail('FAILED_OVERALL_AGREEMENT: retest-low premium missing');
  }
`;

code = code.replace(regex, insert);
fs.writeFileSync('src/backend/validation-rules.ts', code);
