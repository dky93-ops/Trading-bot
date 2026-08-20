const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/passedFilters: string\[\],/g, 'passed: string[],');
code = code.replace(/failedFilters: string\[\],/g, 'failed: string[],');
code = code.replace(/passedFilters: string\[\]/g, 'passed: string[]');
code = code.replace(/failedFilters: string\[\]/g, 'failed: string[]');

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('fixed args back');
