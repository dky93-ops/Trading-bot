const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// fix spotPrice in evaluateIndex end
code = code.replace(/return this\.createNoTrade\(index, spotPrice, 'NO_TRADE: no valid strategy setup found'\);\n  \}\n\n  private getSnapshotAtOrBefore/g, "return this.createNoTrade(index, spot, 'NO_TRADE: no valid strategy setup found');\n  }\n\n  private getSnapshotAtOrBefore");

// Add exitAllActiveTrades
const regex = /public reset\(\) \{\n\s*this\.sessionStates = \{\};\n\s*this\.activeSignals\.clear\(\);\n\s*this\.history\.clear\(\);\n\s*\}/m;
const exitAllCode = `public exitAllActiveTrades(reason: string) {
    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'ACTIVE') {
        const curPrice = signal.latestPrice || signal.optionEntry || signal.entryPrice;
        this.closeSignal(signal, curPrice, reason);
      }
    }
  }`;

if (code.includes('public reset')) {
    code = code.replace(regex, "public reset() {\n    this.sessionStates = {};\n    this.activeSignals.clear();\n    this.history.clear();\n  }\n\n  " + exitAllCode);
} else {
    code += '\n' + exitAllCode + '\n';
}

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed linting errors');
