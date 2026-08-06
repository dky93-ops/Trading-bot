const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Fix target -> target1 in NO_TRADE response
code = code.replace(/target: 0,/, '');
code = code.replace(/stoploss: 0,\n      stoploss: 0,/, 'stoploss: 0,');

code = code.replace(/target: target1,/g, '');

fs.writeFileSync('src/backend/strategy-engine.ts', code);
