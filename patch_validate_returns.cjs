const fs = require('fs');
let file = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// FAILED_RETEST BUY_CALL
file = file.replace(
/if \(rewardRatio >= 0\.8 && sess\.lastFailedSetupLevel !== lvl\) {[\s\S]*?return this\.createSignal\([\s\S]*?c0\.low, c0\.high\n          \);[\s\S]*?}/,
`if (rewardRatio >= 0.8 && sess.lastFailedSetupLevel !== lvl) {
          if (!this.validateSetup(valCtx, 'FAILED_RETEST', 'CALL', lvl, c0, c1, c2, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed)) continue;
          sess.brokenLevelUnderWatch = lvl;
          passed.push(\`Failed Retest Call setup confirmed at level \${lvl}\`);
          return this.createSignal(
            index, 'FAILED_RETEST', 'BUY_CALL', 'CE', spot, lvl, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
            88,
            [
              \`Resistance level \${lvl} broke and retest held successfully above \${lvl}\`,
              \`CE option premium expanded above retest low\`,
              \`Room to upper wall \${wallAbove} is \${rewardRatio.toFixed(2)}R (>= 0.8R required)\`
            ],
            passed, failed,
            c0.low, c0.high
          );
        } else {
          failed.push(\`Failed Retest Call reward ratio \${rewardRatio.toFixed(2)}R is below 0.8R minimum\`);
        }`
);

// FAILED_RETEST BUY_PUT
file = file.replace(
/if \(rewardRatio >= 0\.8 && sess\.lastFailedSetupLevel !== lvl\) {([\s\S]*?)return this\.createSignal\([\s\S]*?c0\.high, c0\.low\n          \);([\s\S]*?)}/,
`if (rewardRatio >= 0.8 && sess.lastFailedSetupLevel !== lvl) {
          if (!this.validateSetup(valCtx, 'FAILED_RETEST', 'PUT', lvl, c0, c1, c2, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed)) continue;
          sess.brokenLevelUnderWatch = lvl;
          passed.push(\`Failed Retest Put setup confirmed at level \${lvl}\`);
          return this.createSignal(
            index, 'FAILED_RETEST', 'BUY_PUT', 'PE', spot, lvl, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
            88,
            [
              \`Support level \${lvl} broke and retest held successfully below \${lvl}\`,
              \`PE option premium expanded above retest high\`,
              \`Room to lower wall \${wallBelow} is \${rewardRatio.toFixed(2)}R (>= 0.8R required)\`
            ],
            passed, failed,
            c0.high, c0.low
          );
        }`
);

// CONTINUATION_BREAKDOWN BUY_PUT
file = file.replace(
/if \(rewardRatio >= 0\.8\) {([\s\S]*?)return this\.createSignal\([\s\S]*?c0\.high, c0\.low\n          \);([\s\S]*?)}/,
`if (rewardRatio >= 0.8) {
          if (!this.validateSetup(valCtx, 'CONTINUATION_BREAKDOWN', 'PUT', lvl, c0, c1, c2, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed)) continue;
          sess.brokenLevelUnderWatch = lvl;
          passed.push(\`Continuation Breakdown Put confirmed at \${lvl}\`);
          return this.createSignal(
            index, 'CONTINUATION_BREAKDOWN', 'BUY_PUT', 'PE', spot, lvl, 0, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
            85,
            [
              \`Clean continuation breakdown below \${lvl}\`,
              \`Room to lower wall \${wallBelow} is \${rewardRatio.toFixed(2)}R\`
            ],
            passed, failed,
            c0.high, c0.low
          );
        }`
);

// CONTINUATION_BREAKOUT BUY_CALL
file = file.replace(
/if \(rewardRatio >= 0\.8\) {([\s\S]*?)return this\.createSignal\([\s\S]*?c0\.low, c0\.high\n          \);([\s\S]*?)}/,
`if (rewardRatio >= 0.8) {
          if (!this.validateSetup(valCtx, 'CONTINUATION_BREAKOUT', 'CALL', lvl, c0, c1, c2, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed)) continue;
          sess.brokenLevelUnderWatch = lvl;
          passed.push(\`Continuation Breakout Call confirmed at \${lvl}\`);
          return this.createSignal(
            index, 'CONTINUATION_BREAKOUT', 'BUY_CALL', 'CE', spot, lvl, wallAbove, 0, atmStrike, ceOpt.price, ceOpt.instrumentKey,
            85,
            [
              \`Clean continuation breakout above \${lvl}\`,
              \`Room to upper wall \${wallAbove} is \${rewardRatio.toFixed(2)}R\`
            ],
            passed, failed,
            c0.low, c0.high
          );
        }`
);

// OPENING_TRAP BUY_CALL
file = file.replace(
/if \(rewardRatio >= 0\.8\) {([\s\S]*?)return this\.createSignal\([\s\S]*?c0\.low, c0\.high\n        \);([\s\S]*?)}/,
`if (rewardRatio >= 0.8) {
          if (!this.validateSetup(valCtx, 'OPENING_TRAP', 'CALL', sess.openingRangeHigh, c0, c1, undefined, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed)) return null;
          sess.brokenLevelUnderWatch = sess.openingRangeHigh;
          passed.push(\`Opening Trap Call confirmed at ORH \${sess.openingRangeHigh}\`);
          return this.createSignal(
            index, 'OPENING_TRAP', 'BUY_CALL', 'CE', spot, sess.openingRangeHigh, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
            90,
            [\`ORH trap confirmed. Room to wall: \${rewardRatio.toFixed(2)}R\`],
            passed, failed,
            c0.low, c0.high
          );
        }`
);

// OPENING_TRAP BUY_PUT
file = file.replace(
/if \(rewardRatio >= 0\.8\) {([\s\S]*?)return this\.createSignal\([\s\S]*?c0\.high, c0\.low\n        \);([\s\S]*?)}/,
`if (rewardRatio >= 0.8) {
          if (!this.validateSetup(valCtx, 'OPENING_TRAP', 'PUT', sess.openingRangeLow, c0, c1, undefined, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed)) return null;
          sess.brokenLevelUnderWatch = sess.openingRangeLow;
          passed.push(\`Opening Trap Put confirmed at ORL \${sess.openingRangeLow}\`);
          return this.createSignal(
            index, 'OPENING_TRAP', 'BUY_PUT', 'PE', spot, sess.openingRangeLow, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
            90,
            [\`ORL trap confirmed. Room to wall: \${rewardRatio.toFixed(2)}R\`],
            passed, failed,
            c0.high, c0.low
          );
        }`
);

// OI_WALL_REJECTION BUY_PUT
file = file.replace(
/if \(rewardRatio >= 1\.0\) {([\s\S]*?)return this\.createSignal\([\s\S]*?c0\.high, c0\.low\n          \);([\s\S]*?)}/,
`if (rewardRatio >= 1.0) {
            if (!this.validateSetup(valCtx, 'OI_WALL_REJECTION', 'PUT', wallAbove, c0, undefined as any, undefined, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, ceWallTests)) return null;
            sess.brokenLevelUnderWatch = wallAbove;
            passed.push(\`CE Wall Rejection Put confirmed at \${wallAbove}\`);
            return this.createSignal(
              index, 'OI_WALL_REJECTION', 'BUY_PUT', 'PE', spot, wallAbove, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
              80,
              [\`CE Wall rejection confirmed. Room to lower wall: \${rewardRatio.toFixed(2)}R\`],
              passed, failed,
              c0.high, c0.low
            );
          }`
);

// OI_WALL_REJECTION BUY_CALL
file = file.replace(
/if \(rewardRatio >= 1\.0\) {([\s\S]*?)return this\.createSignal\([\s\S]*?c0\.low, c0\.high\n          \);([\s\S]*?)}/,
`if (rewardRatio >= 1.0) {
            if (!this.validateSetup(valCtx, 'OI_WALL_REJECTION', 'CALL', wallBelow, c0, undefined as any, undefined, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, peWallTests)) return null;
            sess.brokenLevelUnderWatch = wallBelow;
            passed.push(\`PE Wall Rejection Call confirmed at \${wallBelow}\`);
            return this.createSignal(
              index, 'OI_WALL_REJECTION', 'BUY_CALL', 'CE', spot, wallBelow, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
              80,
              [\`PE Wall rejection confirmed. Room to upper wall: \${rewardRatio.toFixed(2)}R\`],
              passed, failed,
              c0.low, c0.high
            );
          }`
);

fs.writeFileSync('src/backend/strategy-engine.ts', file);
