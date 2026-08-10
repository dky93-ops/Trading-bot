const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const sessState = this\.sessionStates\[index\];/;
const replacement = `const sessState = this.sessionStates[index];
    
    // 0. Active trade gate (Rule 28)
    if (sessState.tradeTakenFlag) {
      return this.createNoTrade(index, spotPrice, 'Active trade gate: trade already taken');
    }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
