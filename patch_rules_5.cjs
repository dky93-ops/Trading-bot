const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const oldR13 = `// RULE 13
export function rule13PremiumConfirmation(setup: ProposedSetup): RuleResult {
  const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) return fail('FAILED_PREMIUM_CONFIRMATION: Missing premium data');
  const [p1, p2, p3] = premiumSeriesLast3;
  if (p3 < p1 * 0.95) return fail('FAILED_PREMIUM_CONFIRMATION: Premium is clearly weakening');
  return pass();
}`;

const newR13 = `// RULE 13
export function rule13PremiumConfirmation(setup: ProposedSetup): RuleResult {
  const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) return fail('FAILED_PREMIUM_CONFIRMATION: Missing premium data');
  const [p1, p2, p3] = premiumSeriesLast3;
  
  // Premium is clearly weakening if p3 is substantially lower than p1 (e.g., dropping by 5% or more over the window)
  if (p3 < p1 * 0.95) return fail('FAILED_PREMIUM_CONFIRMATION: Premium is clearly weakening');
  return pass();
}`;

code = code.replace(oldR13, newR13);

fs.writeFileSync('src/backend/validation-rules.ts', code);
