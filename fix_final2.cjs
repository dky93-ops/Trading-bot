const fs = require('fs');

let stratCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// The botched createSignal return was around line 1105. Let's fix it manually.
const badReturnRegex = /return \{\n\s*timestamp: timestampISO,\n\s*signal: 'NO_TRADE'[\s\S]*?fake_signal_filters_failed: failedFilters\n\s*\} as any;\n\s*\}/m;
stratCode = stratCode.replace(badReturnRegex, `return {
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
  }`);

fs.writeFileSync('src/backend/strategy-engine.ts', stratCode);

let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

// Fix rule argument counts
valCode = valCode.replace(/rule8DominantOIWall\(ctx, setup\)/g, "rule8DominantOIWall(setup)");
valCode = valCode.replace(/rule16RoomToTarget\(setup, ctx\)/g, "rule16RoomToTarget(setup)");

fs.writeFileSync('src/backend/validation-rules.ts', valCode);
