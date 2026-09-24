const fs = require('fs');
let code = fs.readFileSync('src/backend/types.ts', 'utf8');

code = code.replace(
  'export interface OptionChainSnapshot {',
  'export interface OptionChainSnapshot {\n  atmStrike?: number;\n  enhancedRows?: any[];'
);

fs.writeFileSync('src/backend/types.ts', code);
console.log('Fixed types');
