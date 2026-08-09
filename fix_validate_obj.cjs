const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const validateSig = /private validateSetup\([\s\S]*?seriesData\?: any\s*\): boolean \{/;
const newValidateSig = `private validateSetup(
    valCtx: ValidationContext, setupType: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION', direction: 'CALL' | 'PUT', lvl: number,
    c0: Candle, c1: Candle, c2: Candle | undefined, target1: number, target2: number, stoploss: number,
    opt: any, passed: string[], failed: string[], testCount: number = 0, structureId?: string,
    barsSinceBreakout?: number, barsSinceRetest?: number, impulseRange?: number, spotMoveFromLevel?: number,
    breakCandleIndex?: number, retestCandleIndex?: number, confirmationCandleIndex?: number,
    seriesData?: any
  ): boolean {`;

engine = engine.replace(validateSig, newValidateSig);

engine = engine.replace(/this\.validateSetup\(([^,]+),\s*'FAILED_RETEST',\s*'CALL',\s*lvl,\s*c0,\s*candles\[callRetestIdx\],\s*candles\[callBreakIdx\],\s*wallAbove,\s*0,\s*candles\[callRetestIdx\]\.low,\s*ceOpt,\s*passed,\s*failed,\s*0,\s*structureId,\s*barsSinceBreak,\s*barsSinceRetest,\s*undefined,\s*spot - lvl,\s*series\)/,
  "this.validateSetup($1, 'FAILED_RETEST', 'CALL', lvl, c0, candles[callRetestIdx], candles[callBreakIdx], wallAbove, 0, candles[callRetestIdx].low, ceOpt, passed, failed, 0, structureId, barsSinceBreak, barsSinceRetest, undefined, spot - lvl, callBreakIdx, callRetestIdx, c0Index, series)"
);

engine = engine.replace(/this\.validateSetup\(([^,]+),\s*'FAILED_RETEST',\s*'PUT',\s*lvl,\s*c0,\s*candles\[putRetestIdx\],\s*candles\[putBreakIdx\],\s*wallBelow,\s*0,\s*candles\[putRetestIdx\]\.high,\s*peOpt,\s*passed,\s*failed,\s*0,\s*structureId,\s*barsSinceBreak,\s*barsSinceRetest,\s*undefined,\s*spot - lvl,\s*series\)/,
  "this.validateSetup($1, 'FAILED_RETEST', 'PUT', lvl, c0, candles[putRetestIdx], candles[putBreakIdx], wallBelow, 0, candles[putRetestIdx].high, peOpt, passed, failed, 0, structureId, barsSinceBreak, barsSinceRetest, undefined, spot - lvl, putBreakIdx, putRetestIdx, c0Index, series)"
);

engine = engine.replace(/this\.validateSetup\(([^,]+),\s*'CONTINUATION_BREAKDOWN',\s*'PUT',\s*lvl,\s*c0,\s*candles\[c0Index-1\],\s*candles\[putBreakIdx\],\s*wallBelow,\s*0,\s*candles\[putBreakIdx\]\.high,\s*peOpt,\s*passed,\s*failed,\s*0,\s*structureId,\s*barsSinceBreak,\s*undefined,\s*impulseRange,\s*spot - lvl,\s*series\)/,
  "this.validateSetup($1, 'CONTINUATION_BREAKDOWN', 'PUT', lvl, c0, candles[c0Index-1], candles[putBreakIdx], wallBelow, 0, candles[putBreakIdx].high, peOpt, passed, failed, 0, structureId, barsSinceBreak, undefined, impulseRange, spot - lvl, putBreakIdx, undefined, c0Index, series)"
);

engine = engine.replace(/this\.validateSetup\(([^,]+),\s*'CONTINUATION_BREAKOUT',\s*'CALL',\s*lvl,\s*c0,\s*candles\[c0Index-1\],\s*candles\[callBreakIdx\],\s*wallAbove,\s*0,\s*candles\[callBreakIdx\]\.low,\s*ceOpt,\s*passed,\s*failed,\s*0,\s*structureId,\s*barsSinceBreak,\s*undefined,\s*impulseRange,\s*spot - lvl,\s*series\)/,
  "this.validateSetup($1, 'CONTINUATION_BREAKOUT', 'CALL', lvl, c0, candles[c0Index-1], candles[callBreakIdx], wallAbove, 0, candles[callBreakIdx].low, ceOpt, passed, failed, 0, structureId, barsSinceBreak, undefined, impulseRange, spot - lvl, callBreakIdx, undefined, c0Index, series)"
);

engine = engine.replace(/this\.validateSetup\(([^,]+),\s*'OPENING_TRAP',\s*'CALL',\s*sess\.openingRangeHigh,\s*c0,\s*candles\[callRetestIdx\],\s*candles\[callBreakIdx\],\s*wallAbove,\s*0,\s*candles\[callRetestIdx\]\.low,\s*ceOpt,\s*passed,\s*failed,\s*0,\s*structureId,\s*barsSinceBreak,\s*barsSinceRetest,\s*undefined,\s*spot - sess\.openingRangeHigh,\s*series\)/,
  "this.validateSetup($1, 'OPENING_TRAP', 'CALL', sess.openingRangeHigh, c0, candles[callRetestIdx], candles[callBreakIdx], wallAbove, 0, candles[callRetestIdx].low, ceOpt, passed, failed, 0, structureId, barsSinceBreak, barsSinceRetest, undefined, spot - sess.openingRangeHigh, callBreakIdx, callRetestIdx, c0Index, series)"
);

engine = engine.replace(/this\.validateSetup\(([^,]+),\s*'OPENING_TRAP',\s*'PUT',\s*sess\.openingRangeLow,\s*c0,\s*candles\[putRetestIdx\],\s*candles\[putBreakIdx\],\s*wallBelow,\s*0,\s*candles\[putRetestIdx\]\.high,\s*peOpt,\s*passed,\s*failed,\s*0,\s*structureId,\s*barsSinceBreak,\s*barsSinceRetest,\s*undefined,\s*spot - sess\.openingRangeLow,\s*series\)/,
  "this.validateSetup($1, 'OPENING_TRAP', 'PUT', sess.openingRangeLow, c0, candles[putRetestIdx], candles[putBreakIdx], wallBelow, 0, candles[putRetestIdx].high, peOpt, passed, failed, 0, structureId, barsSinceBreak, barsSinceRetest, undefined, spot - sess.openingRangeLow, putBreakIdx, putRetestIdx, c0Index, series)"
);

engine = engine.replace(/this\.validateSetup\(([^,]+),\s*'OI_WALL_REJECTION',\s*'PUT',\s*wallAbove,\s*c0,\s*c0,\s*undefined,\s*wallBelow,\s*0,\s*c0\.high,\s*peOpt,\s*passed,\s*failed,\s*tests,\s*structureId,\s*undefined,\s*undefined,\s*undefined,\s*spot - wallAbove,\s*series\)/,
  "this.validateSetup($1, 'OI_WALL_REJECTION', 'PUT', wallAbove, c0, c0, undefined, wallBelow, 0, c0.high, peOpt, passed, failed, tests, structureId, undefined, undefined, undefined, spot - wallAbove, undefined, undefined, c0Index, series)"
);

engine = engine.replace(/this\.validateSetup\(([^,]+),\s*'OI_WALL_REJECTION',\s*'CALL',\s*wallBelow,\s*c0,\s*c0,\s*undefined,\s*wallAbove,\s*0,\s*c0\.low,\s*ceOpt,\s*passed,\s*failed,\s*tests,\s*structureId,\s*undefined,\s*undefined,\s*undefined,\s*spot - wallBelow,\s*series\)/,
  "this.validateSetup($1, 'OI_WALL_REJECTION', 'CALL', wallBelow, c0, c0, undefined, wallAbove, 0, c0.low, ceOpt, passed, failed, tests, structureId, undefined, undefined, undefined, spot - wallBelow, undefined, undefined, c0Index, series)"
);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
