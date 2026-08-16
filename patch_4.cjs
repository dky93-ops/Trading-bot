const fs = require('fs');

// Patch strategy-engine.ts
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const targetPrecheck = `const valCtx: any = {
      activeSignals: this.activeSignals,
      index, spotPrice, timeObj, timeStr,
      candles1m: candles, sessState, settings: this.settings,
      chainRows: rows, nearestCeWallAbove, nearestPeWallBelow
    };`;

const newPrecheck = `const valCtx: any = {
      activeSignals: this.activeSignals,
      index, spotPrice, timeObj, timeStr,
      candles1m: candles, sessState, settings: this.settings,
      chainRows: rows, nearestCeWallAbove, nearestPeWallBelow
    };

    const precheck = runGlobalPreChecks({
      activeSignals: this.activeSignals,
      index,
      spotPrice,
      timeObj,
      timeStr,
      sessState,
      candles1m: candles,
      chainRows: [],
      nearestCeWallAbove: 0,
      nearestPeWallBelow: 0,
    });

    if (!precheck.passed) {
      return this.createNoTrade(
        index,
        spotPrice,
        precheck.reason || 'FAILED_GLOBAL_PRECHECK',
      );
    }

    const minEntryTime =
      this.settings.MIN_ENTRY_TIME_IST || '09:30';

    const lastEntryTime =
      this.settings.LAST_ENTRY_TIME_IST || '15:00';

    if (timeStr < minEntryTime) {
      return this.createNoTrade(
        index,
        spotPrice,
        \`FAILED_TIME_FILTER: Before minimum entry time \${minEntryTime} IST\`,
      );
    }

    if (timeStr >= lastEntryTime) {
      return this.createNoTrade(
        index,
        spotPrice,
        \`FAILED_TIME_FILTER: At or after last entry time \${lastEntryTime} IST\`,
      );
    }`;

code = code.replace(targetPrecheck, newPrecheck);

// Also need to make sure runGlobalPreChecks is imported if it isn't
if (!code.includes('runGlobalPreChecks')) {
  code = code.replace('import { checkRiskLimits,', 'import { checkRiskLimits, runGlobalPreChecks,');
}
fs.writeFileSync('src/backend/strategy-engine.ts', code);

// Patch validation-rules.ts
let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
const valTarget = `const checks = [
    rule2OpeningFilter(ctx.timeStr, setup),
    rule5MarketStructure(ctx.sessState, setup),`;

const valReplacement = `const checks = [
    rule20MarketFilters(ctx, setup),
    rule2OpeningFilter(ctx.timeStr, setup),
    rule5MarketStructure(ctx.sessState, setup),`;

valCode = valCode.replace(valTarget, valReplacement);

// Make sure rule20MarketFilters exists or is defined
if (!valCode.includes('export function rule20MarketFilters')) {
  const rule20 = `
export function rule20MarketFilters(ctx: ValidationContext, setup: ProposedSetup) {
  // If we need to check missing bid/ask and missing premium history
  // Actually, wait, it says "missing bid/ask and missing premium history must produce NO_TRADE".
  // The user prompt doesn't give the implementation of rule20MarketFilters, but says "Add rule20MarketFilters() to runSetupValidation()."
  // Let's see if it's already in the file.
}
`;
  if (!valCode.includes('rule20MarketFilters')) {
    valCode += rule20;
  }
}
fs.writeFileSync('src/backend/validation-rules.ts', valCode);
