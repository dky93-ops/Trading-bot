const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

if (!engine.includes('candidateCEWalls: {},')) {
  engine = engine.replace(/wallTestCounts: \{\},/, "candidateCEWalls: {},\n      candidatePEWalls: {},\n      wallTestCounts: {},");
}

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
