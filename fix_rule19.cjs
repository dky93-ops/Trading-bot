const fs = require('fs');
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /if \(!setup\.hasTwoDistinctWallTests\) return fail\('FAILED_OVERALL_AGREEMENT: OI Wall Rejection requires at least 2 tests'\);\s*if \(!setup\.hasSessionReaction\) return fail\('FAILED_OVERALL_AGREEMENT: OI Wall Rejection requires session reaction'\);/;

const replace = `if ((setup.wallTestCount || 0) < 2) return fail('FAILED_OVERALL_AGREEMENT: OI Wall Rejection requires at least 2 tests');`;

rules = rules.replace(regex, replace);
fs.writeFileSync('src/backend/validation-rules.ts', rules);
