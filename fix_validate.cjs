const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex1 = /barsSinceBreakout\?: number, barsSinceRetest\?: number, impulseRange\?: number, spotMoveFromLevel\?: number,/;
const replace1 = `barsSinceBreakout?: number, barsSinceRetest?: number, impulseRange?: number, spotMoveFromLevel?: number,
    breakCandleIndex?: number, retestCandleIndex?: number, confirmationCandleIndex?: number,`;
engine = engine.replace(regex1, replace1);

const regex2 = /barsSinceBreakout,\n\s*barsSinceRetest,\n\s*impulseRange,\n\s*spotMoveFromLevel,\n\s*premiumAtConfirmation: opt\?\.price,/;
const replace2 = `barsSinceBreakout,
      barsSinceRetest,
      impulseRange,
      spotMoveFromLevel,
      premiumAtConfirmation: opt?.price,
      breakCandleIndex,
      retestCandleIndex,
      confirmationCandleIndex,`;
engine = engine.replace(regex2, replace2);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
