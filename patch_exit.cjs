const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /this\.closeTrade\(id, (.*?), (.*?)\);/g;
const replacement = `this.closeTrade(id, $1, $2);\n        const sess = this.sessionStates[signal.index || 'NIFTY'];\n        if (sess) sess.tradeTakenFlag = false;`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
