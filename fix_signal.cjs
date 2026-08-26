const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-signals-generator.ts', 'utf-8');
code = code.replace(/impulseRange,/g, '');
fs.writeFileSync('src/backend/strategy-signals-generator.ts', code);
console.log('Fixed signal types');
