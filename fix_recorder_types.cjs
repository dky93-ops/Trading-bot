const fs = require('fs');
let code = fs.readFileSync('src/backend/enhanced-option-chain-recorder.ts', 'utf-8');
code = code.replace(/maxCallOIStrike/g, 'maxCallStrike');
code = code.replace(/maxPutOIStrike/g, 'maxPutStrike');
fs.writeFileSync('src/backend/enhanced-option-chain-recorder.ts', code);
console.log('Fixed recorder types');
