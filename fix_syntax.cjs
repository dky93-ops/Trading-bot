const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /    \} else \{\n      sessState\.sessionHigh = spotPrice;\n      sessState\.sessionLow = spotPrice;\n      sessState\.openingRangeHigh = 0;\n      sessState\.openingRangeLow = 0;\n    \}/g;

code = code.replace(regex, "");
fs.writeFileSync('src/backend/strategy-engine.ts', code);
