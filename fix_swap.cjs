const fs = require('fs');

let stratCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// I will extract the blocks using their exact current content and replace them with the correct content.
const onTickBlock = `    // NO_TRADE Decision Output
    return {
      id: crypto.randomUUID(),
      index,
      contract: instrumentKey,
      instrumentKey,
      action: signalType,
      strategy: strategyFamily,
      entryPrice: premium,
      stoploss: slPrice,
      target1: target1Price,
      target2: target2Price,
      status: 'ACTIVE',
      timestamp: timestampISO,
      confidence: finalConfidence,
      reason: reasons,
      direction: signalType === 'BUY_CALL' ? 'CALL' : 'PUT',
      fake_signal_filters_passed: passedFilters,
      fake_signal_filters_failed: failedFilters
    } as any;
  }`;

const createSignalBlock = `    return {
      timestamp: timestampISO,
      signal: 'NO_TRADE',
      strategy_family: 'NONE',
      direction: 'NONE',
      spot: spotPrice,
      broken_level: sessState.brokenLevelUnderWatch || 0,
      wall_above: nearestCeWallAbove,
      wall_below: nearestPeWallBelow,
      option_type: 'NONE',
      strike: Math.round(spotPrice / step) * step,
      entry: 0,
      stoploss: 0,
      target1: 0,
      target2: 0,
      confidence: 0,
      reason: [
        \`No valid high-probability strategy signal found on \${index}.\`,
        failedFilters.length > 0 ? \`Failed filter checks: \${failedFilters.join('; ')}\` : 'Awaiting clean breakout/retest structure and OI confirmation.'
      ],
      fake_signal_filters_passed: passedFilters,
      fake_signal_filters_failed: failedFilters
    } as any;
  }`;

const correctOnTick = `    // NO_TRADE Decision Output
    return [{
      timestamp: timestampISO,
      signal: 'NO_TRADE',
      strategy_family: 'NONE',
      direction: 'NONE',
      spot: spotPrice,
      broken_level: sessState.brokenLevelUnderWatch || 0,
      wall_above: nearestCeWallAbove,
      wall_below: nearestPeWallBelow,
      option_type: 'NONE',
      strike: Math.round(spotPrice / step) * step,
      entry: 0,
      stoploss: 0,
      target1: 0,
      target2: 0,
      confidence: 0,
      reason: [
        \`No valid high-probability strategy signal found on \${index}.\`,
        failedFilters.length > 0 ? \`Failed filter checks: \${failedFilters.join('; ')}\` : 'Awaiting clean breakout/retest structure and OI confirmation.'
      ],
      fake_signal_filters_passed: passedFilters,
      fake_signal_filters_failed: failedFilters
    } as any];
  }`;

const correctCreateSignal = `    return {
      id: crypto.randomUUID(),
      index,
      contract: instrumentKey, // For TS interface compliance
      instrumentKey,
      action: signalType,
      strategy: strategyFamily,
      entryPrice: premium,
      stoploss: slPrice,
      target1: target1Price,
      target2: target2Price,
      status: 'ACTIVE',
      timestamp: timestampISO,
      confidence: finalConfidence,
      reason: reasons,
      direction: signalType === 'BUY_CALL' ? 'CALL' : 'PUT',
      fake_signal_filters_passed: passedFilters,
      fake_signal_filters_failed: failedFilters
    } as InternalSignal;
  }`;

stratCode = stratCode.replace(onTickBlock, correctOnTick);
stratCode = stratCode.replace(createSignalBlock, correctCreateSignal);

fs.writeFileSync('src/backend/strategy-engine.ts', stratCode);
