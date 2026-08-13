const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /wallOIWeakeningConfirmed: \{\},/;
const replacement = "wallOIWeakeningConfirmed: {},\n      wallPeakOI: {},\n      wallNegativeOIAlignedKeys: {},\n      wallInvalidForRejection: {},";

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 3 wall fields complete');
