const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/passedFilters/g, 'passed');
code = code.replace(/failedFilters/g, 'failed');

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('fixed all');
