const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// 1. Update validateSetup signature to include chainRows
code = code.replace(
  /seriesData\?: any\n  \): boolean \{/,
  "seriesData?: any,\n    chainRows?: any[]\n  ): boolean {"
);

// 2. Add targets and confidence logic into validateSetup
const validateRegex = /const valid = runSetupValidation\(valCtx, setup, \[\], testCount\);\n\s*if \(\!valid\.passed\) \{\n\s*failed\.push\(\.\.\.valid\.errors\);\n\s*return false;\n\s*\}/;
const validateReplacement = `const valid = runSetupValidation(valCtx, setup, [], testCount);
    if (!valid.passed) {
      failed.push(...valid.errors);
      return false;
    }
    if (chainRows) {
      const targets = this.computeSpotTargets(
        direction,
        setup.entrySpot || c0.close,
        stoploss,
        chainRows,
        valCtx.sessState
      );
      if (targets) {
        const riskSpot = direction === 'CALL'
          ? (setup.entrySpot || c0.close) - targets.structuralStopSpot
          : targets.structuralStopSpot - (setup.entrySpot || c0.close);
        const reward1 = direction === 'CALL'
          ? targets.target1Spot - (setup.entrySpot || c0.close)
          : (setup.entrySpot || c0.close) - targets.target1Spot;
        const reward2 = direction === 'CALL'
          ? targets.target2Spot - (setup.entrySpot || c0.close)
          : (setup.entrySpot || c0.close) - targets.target2Spot;
          
        setup.rewardToRiskTarget1 = riskSpot > 0 ? reward1 / riskSpot : 0;
        setup.rewardToRiskTarget2 = riskSpot > 0 && targets.target2Spot > 0 ? reward2 / riskSpot : 0;
      }
    }
    
    setup.feedSyncPenalty = 0; // or any logic
    const confidence = this.calculateDeterministicConfidence(setup);
    if (confidence < 50) {
      failed.push(\`FAILED_CONFIDENCE: deterministic confidence \${confidence} < 50\`);
      return false;
    }
    setup.confidence = confidence;`;

code = code.replace(validateRegex, validateReplacement);

// 3. Update validateSetup calls to pass chainRows
code = code.replace(/validateSetup\(valCtx, 'FAILED_RETEST',([^)]+)\)/g, "validateSetup(valCtx, 'FAILED_RETEST',$1, chainRows)");
code = code.replace(/validateSetup\(valCtx, 'CONTINUATION_BREAKDOWN',([^)]+)\)/g, "validateSetup(valCtx, 'CONTINUATION_BREAKDOWN',$1, chainRows)");
code = code.replace(/validateSetup\(valCtx, 'CONTINUATION_BREAKOUT',([^)]+)\)/g, "validateSetup(valCtx, 'CONTINUATION_BREAKOUT',$1, chainRows)");
code = code.replace(/validateSetup\(valCtx, 'OPENING_TRAP',([^)]+)\)/g, "validateSetup(valCtx, 'OPENING_TRAP',$1, chainRows)");
code = code.replace(/validateSetup\(valCtx, 'OI_WALL_REJECTION',([^)]+)\)/g, "validateSetup(valCtx, 'OI_WALL_REJECTION',$1, chainRows)");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed validateSetup');
