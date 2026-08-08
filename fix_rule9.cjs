const fs = require('fs');
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule9WallTestedTwice\([\s\S]*?return pass\(\);\n\}/;
const replace = `export function rule9WallTestedTwice(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'OI_WALL_REJECTION') {
    if ((setup.wallTestCount || 0) < 2) {
      return fail('FAILED_WALL_TEST_COUNT: Wall was not tested at least 2 distinct times');
    }
  }
  return pass();
}`;

rules = rules.replace(regex, replace);
fs.writeFileSync('src/backend/validation-rules.ts', rules);
