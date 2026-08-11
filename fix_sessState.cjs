const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/chainRows, sessState\)/g, "chainRows, sess)");
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed sessState to sess');
