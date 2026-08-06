const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/const step = index === 'NIFTY' \? 50 : 100;\n/, 
`const step = index === 'NIFTY' ? 50 : 100;
    const globalAtmStrike = Math.round(spotPrice / step) * step;
    const seriesData = this.extractSeries(globalAtmStrike);\n`);
    
// Replace validateSetup(...) calls with seriesData
code = code.replace(/validateSetup\(valCtx, 'FAILED_RETEST', 'CALL', lvl, c0, c1, c2, wallAbove, wallAbove \+ 50, c0\.low, ceOpt, passed, failed, 0, structureId\)/g,
  "validateSetup(valCtx, 'FAILED_RETEST', 'CALL', lvl, c0, c1, c2, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, 0, structureId, undefined, undefined, undefined, undefined, seriesData)");

code = code.replace(/validateSetup\(valCtx, 'FAILED_RETEST', 'PUT', lvl, c0, c1, c2, wallBelow, wallBelow \- 50, c0\.high, peOpt, passed, failed, 0, structureId\)/g,
  "validateSetup(valCtx, 'FAILED_RETEST', 'PUT', lvl, c0, c1, c2, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, 0, structureId, undefined, undefined, undefined, undefined, seriesData)");

code = code.replace(/validateSetup\(valCtx, 'CONTINUATION_BREAKDOWN', 'PUT', lvl, c0, c1, c2, wallBelow, wallBelow \- 50, c0\.high, peOpt, passed, failed, 0, structureId, undefined, undefined, impulseRange\)/g,
  "validateSetup(valCtx, 'CONTINUATION_BREAKDOWN', 'PUT', lvl, c0, c1, c2, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, 0, structureId, undefined, undefined, impulseRange, undefined, seriesData)");

code = code.replace(/validateSetup\(valCtx, 'CONTINUATION_BREAKOUT', 'CALL', lvl, c0, c1, c2, wallAbove, wallAbove \+ 50, c0\.low, ceOpt, passed, failed, 0, structureId, undefined, undefined, impulseRange\)/g,
  "validateSetup(valCtx, 'CONTINUATION_BREAKOUT', 'CALL', lvl, c0, c1, c2, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, 0, structureId, undefined, undefined, impulseRange, undefined, seriesData)");

code = code.replace(/validateSetup\(valCtx, 'OPENING_TRAP', 'CALL', sess\.openingRangeHigh, c0, c1, undefined, wallAbove, wallAbove \+ 50, c0\.low, ceOpt, passed, failed, 0, structureId\)/g,
  "validateSetup(valCtx, 'OPENING_TRAP', 'CALL', sess.openingRangeHigh, c0, c1, undefined, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, 0, structureId, undefined, undefined, undefined, undefined, seriesData)");

code = code.replace(/validateSetup\(valCtx, 'OPENING_TRAP', 'PUT', sess\.openingRangeLow, c0, c1, undefined, wallBelow, wallBelow \- 50, c0\.high, peOpt, passed, failed, 0, structureId\)/g,
  "validateSetup(valCtx, 'OPENING_TRAP', 'PUT', sess.openingRangeLow, c0, c1, undefined, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, 0, structureId, undefined, undefined, undefined, undefined, seriesData)");

code = code.replace(/validateSetup\(valCtx, 'OI_WALL_REJECTION', 'PUT', wallAbove, c0, c0, undefined, wallBelow, wallBelow \- 50, c0\.high, peOpt, passed, failed, ceWallTests, structureId\)/g,
  "validateSetup(valCtx, 'OI_WALL_REJECTION', 'PUT', wallAbove, c0, c0, undefined, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, ceWallTests, structureId, undefined, undefined, undefined, undefined, seriesData)");

code = code.replace(/validateSetup\(valCtx, 'OI_WALL_REJECTION', 'CALL', wallBelow, c0, c0, undefined, wallAbove, wallAbove \+ 50, c0\.low, ceOpt, passed, failed, peWallTests, structureId\)/g,
  "validateSetup(valCtx, 'OI_WALL_REJECTION', 'CALL', wallBelow, c0, c0, undefined, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, peWallTests, structureId, undefined, undefined, undefined, undefined, seriesData)");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
