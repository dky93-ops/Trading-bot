const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const sess = this\.sessionStates\[signal\.index\];\s*if \(sess\) \{\s*sess\.lastTradeExitTime = Date\.now\(\);\s*if \(signal\.realizedPnL < 0 \|\| reason\.includes\('SL'\) \|\| reason\.includes\('INVALIDATION'\)\) \{\s*if \(signal\.broken_level > 0\) \{\s*sess\.lastFailedSetupLevel = signal\.broken_level;\s*\}\s*\}\s*\}/;

const replacement = `const sessState2 = this.sessionStates[signal.index];
    if (sessState2) {
      sessState2.lastTradeExitTime = Date.now();
      if (signal.realizedPnL < 0 || reason.includes('SL') || reason.includes('INVALIDATION')) {
        if (signal.broken_level > 0) {
          sessState2.last_failed_setup_level = signal.broken_level;
        }
      }
    }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
