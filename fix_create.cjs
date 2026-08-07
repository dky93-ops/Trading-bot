const fs = require('fs');

let stratCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const createSignalBlock = `    return {
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
    } as InternalSignal;`;

const correctCreate = `    return {
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
      fake_signal_filters_failed: failedFilters,
      // EngineDecision required fields:
      signal: signalType,
      strategy_family: strategyFamily,
      spot: spot,
      broken_level: brokenLevel,
      wall_above: wallAbove,
      wall_below: wallBelow,
      option_type: optType,
      strike: strike,
      entry: premium
    } as InternalSignal;`;

stratCode = stratCode.replace(createSignalBlock, correctCreate);

fs.writeFileSync('src/backend/strategy-engine.ts', stratCode);
