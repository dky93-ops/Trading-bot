const fs = require('fs');

let stratCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// The botched return in evaluateIndex
const onTickBlockArr = `    // NO_TRADE Decision Output
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

const correctReturn = `    // NO_TRADE Decision Output
    return {
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

stratCode = stratCode.replace(onTickBlockArr, correctReturn);
fs.writeFileSync('src/backend/strategy-engine.ts', stratCode);
