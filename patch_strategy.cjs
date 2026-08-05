const fs = require('fs');
let file = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const validateSetupFn = `
  private validateSetup(
    valCtx: ValidationContext, setupType: string, direction: 'CALL' | 'PUT', lvl: number,
    c0: Candle, c1: Candle, c2: Candle | undefined, target1: number, target2: number, stopLoss: number,
    opt: any, passed: string[], failed: string[], testCount: number = 0
  ): boolean {
    const setup: ProposedSetup = {
      direction, level: lvl, setupType, c0, c1, c2, target1, target2, stopLoss,
      ceOpt: direction === 'CALL' ? opt : undefined,
      peOpt: direction === 'PUT' ? opt : undefined,
    };
    const validLevels = [
      valCtx.sessState.openingRangeHigh, valCtx.sessState.openingRangeLow,
      valCtx.sessState.previousDayHigh, valCtx.sessState.previousDayLow,
      valCtx.sessState.sessionHigh, valCtx.sessState.sessionLow,
      valCtx.nearestCEWallAbove, valCtx.nearestPEWallBelow
    ].filter(l => l > 0);
    const result = runSetupValidation(valCtx, setup, validLevels, testCount);
    if (!result.passed) {
      failed.push(\`[STRICT 20-RULE] \${setupType} \${direction} Rejected: \${result.reason}\`);
      return false;
    }
    return true;
  }
`;

// Insert validateSetupFn into StrategyEngine class
file = file.replace(/  private async checkFailedRetest/, validateSetupFn + '\n  private async checkFailedRetest');

fs.writeFileSync('src/backend/strategy-engine.ts', file);
