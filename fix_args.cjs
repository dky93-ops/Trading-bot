const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/passed: string\[\],/g, 'passedFilters: string[],');
code = code.replace(/failed: string\[\],/g, 'failedFilters: string[],');
code = code.replace(/passed: string\[\]/g, 'passedFilters: string[]');
code = code.replace(/failed: string\[\]/g, 'failedFilters: string[]');

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('fixed args');
