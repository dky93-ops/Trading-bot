const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /\npublic exitAllActiveTrades\(reason: string\) \{\n    for \(const \[id, signal\] of this\.activeSignals\.entries\(\)\) \{\n      if \(signal\.status === 'ACTIVE'\) \{\n        const curPrice = signal\.latestPrice \|\| signal\.optionEntry \|\| signal\.entryPrice;\n        this\.closeSignal\(signal, curPrice, reason\);\n      \}\n    \}\n  \}\n$/m;

code = code.replace(regex, "");

const insertRegex = /public reset\(\) \{\n    this\.sessionStates = \{\};\n    this\.activeSignals\.clear\(\);\n    this\.history\.clear\(\);\n  \}\n/m;
const insertCode = `public reset() {
    this.sessionStates = {};
    this.activeSignals.clear();
    this.history.clear();
  }

  public exitAllActiveTrades(reason: string) {
    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'ACTIVE') {
        const curPrice = signal.latestPrice || signal.optionEntry || signal.entryPrice;
        this.closeSignal(signal, curPrice, reason);
      }
    }
  }
`;

code = code.replace(insertRegex, insertCode);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed syntax error');
