const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/private getNearestExpiry\?: GetNearestExpiryFn,\n    getOptionChainHistory\?: \(\) => any\[\];/, 
"private getNearestExpiry?: GetNearestExpiryFn;\n  private getOptionChainHistory?: () => any[];");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
