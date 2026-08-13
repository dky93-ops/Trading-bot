const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
code = code.replace(/setupType, c0: \{\} as any/g, "setupType: setupType as any, c0: {} as any");
code = code.replace(/strategy_family: setupType,/g, "strategy_family: setupType as any,");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
