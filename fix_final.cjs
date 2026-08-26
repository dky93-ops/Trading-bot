const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');
code = code.replace(/lastUpdateTime/g, 'timestamp');
fs.writeFileSync('src/backend/strategy-engine.ts', code);

let code2 = fs.readFileSync('src/backend/enhanced-option-chain-recorder.ts', 'utf-8');
code2 = code2.replace(/maxCallStrike: 0,/g, 'maxCallOIStrike: 0,');
code2 = code2.replace(/maxPutStrike: 0,/g, 'maxPutOIStrike: 0,');
fs.writeFileSync('src/backend/enhanced-option-chain-recorder.ts', code2);
console.log('Fixed final types');
