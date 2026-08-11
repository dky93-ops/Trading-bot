const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(
  /\} as ProposedSetup\)/g,
  "} as unknown as ProposedSetup)"
);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed typecast');
