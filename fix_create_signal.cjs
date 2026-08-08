const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

engine = engine.replace(/\} as InternalSignal;\s*\}/, '} as InternalSignal;\n    return internalSig;\n  }');
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
