const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Fix the inverted OI rejection condition
code = code.replace(/!sess\.wallOIWeakeningConfirmed\[wallAbove\]/g, "(sess.wallOIWeakeningConfirmed[wallAbove] === true && sess.wallInvalidForRejection[wallAbove] !== true)");
code = code.replace(/!sess\.wallOIWeakeningConfirmed\[wallBelow\]/g, "(sess.wallOIWeakeningConfirmed[wallBelow] === true && sess.wallInvalidForRejection[wallBelow] !== true)");

code = code.replace(/\(sess\.wallNegativeOICounts\[wallAbove\] \|\| 0\) < 2/g, "(sess.wallNegativeOIAlignedKeys[wallAbove]?.length >= 3)");
code = code.replace(/\(sess\.wallNegativeOICounts\[wallBelow\] \|\| 0\) < 2/g, "(sess.wallNegativeOIAlignedKeys[wallBelow]?.length >= 3)");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 3 rejection complete');
