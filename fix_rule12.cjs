const fs = require('fs');
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex1 = /export function rule12ConfirmationCandle\([\s\S]*?return pass\(\);\n\}/;
const replace1 = `export function rule12ConfirmationCandle(setup: ProposedSetup, index: string): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  const minBody = index === 'NIFTY' ? 0.1 : 0.2;
  
  if (isCall) {
    if (c0.close <= c0.open + minBody) return fail('FAILED_CONFIRMATION_CANDLE: Confirmation candle must be bullish');
  } else {
    if (c0.close >= c0.open - minBody) return fail('FAILED_CONFIRMATION_CANDLE: Confirmation candle must be bearish');
  }
  return pass();
}`;
rules = rules.replace(regex1, replace1);

const regex2 = /export function rule14MixedDirection\([\s\S]*?return pass\(\);\n\}/;
const replace2 = `export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  
  if (isCall && c0.close <= c0.open) {
    return fail('FAILED_MIXED_DIRECTION: CALL requires bullish confirmation');
  }
  if (!isCall && c0.close >= c0.open) {
    return fail('FAILED_MIXED_DIRECTION: PUT requires bearish confirmation');
  }
  return pass();
}`;
rules = rules.replace(regex2, replace2);

fs.writeFileSync('src/backend/validation-rules.ts', rules);
