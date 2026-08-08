const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex1 = /if \(tests >= 2 && sess\.wallOIWeakeningConfirmed\[wallAbove\]\)/;
const replacement1 = `if (tests >= 2 && !sess.wallOIWeakeningConfirmed[wallAbove] && (sess.wallNegativeOICounts[wallAbove] || 0) < 2)`;

const regex2 = /if \(tests >= 2 && sess\.wallOIWeakeningConfirmed\[wallBelow\]\)/;
const replacement2 = `if (tests >= 2 && !sess.wallOIWeakeningConfirmed[wallBelow] && (sess.wallNegativeOICounts[wallBelow] || 0) < 2)`;

engine = engine.replace(regex1, replacement1);
engine = engine.replace(regex2, replacement2);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
