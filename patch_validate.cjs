const fs = require('fs');
let file = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

file = file.replace(
/return this\.createSignal\([\s\S]*?\);/g,
(match) => {
  return `
          const setupValidCtx: ProposedSetup = {
            direction: arguments[2] === 'BUY_CALL' ? 'CALL' : 'PUT',
            level: lvl, // requires lvl in scope, we will hack it or rely on existing lvl
            setupType: arguments[1],
            c0, c1, c2: typeof c2 !== 'undefined' ? c2 : undefined,
            target1: typeof wallAbove !== 'undefined' ? wallAbove : spot + 100, // mock targets for validation
            target2: typeof wallAbove !== 'undefined' ? wallAbove + 100 : spot + 200,
            stopLoss: c0.low,
            ceOpt: typeof ceOpt !== 'undefined' ? ceOpt : undefined,
            peOpt: typeof peOpt !== 'undefined' ? peOpt : undefined,
          };
          // ... wait this regex replace might break things because arguments is not available like this in JS arrow functions, and the parameters vary.
          ${match}
`;
}
);
// I will not use this regex approach.
