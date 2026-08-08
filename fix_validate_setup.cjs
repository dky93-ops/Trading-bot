const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /barsSinceRetest,\n\s*impulseRange,\n\s*spotMoveFromLevel,\n\s*spotSeriesLast3/;

const replace = `barsSinceRetest,
      impulseRange,
      spotMoveFromLevel,
      premiumAtConfirmation: opt?.price,
      spotSeriesLast3`;

engine = engine.replace(regex, replace);
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
