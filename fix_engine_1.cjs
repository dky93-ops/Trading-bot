const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/openingRangeLow: 0,/, "openingRangeLow: 0,\n      openingRangeComplete: false,");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
