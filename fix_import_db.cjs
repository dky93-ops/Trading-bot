const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/const getCandles = [\s\S]*?\n/, "import { getCandles } from '../db/market';\n");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed DB import');
