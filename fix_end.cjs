const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /\}\s*$/;
const insertCode = `
  public exitAllActiveTrades(reason: string) {
    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'ACTIVE') {
        const curPrice = signal.latestPrice || signal.optionEntry || signal.entryPrice;
        this.closeSignal(signal, curPrice, reason);
      }
    }
  }
}
`;

code = code.replace(regex, insertCode);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed exitAllActiveTrades');
