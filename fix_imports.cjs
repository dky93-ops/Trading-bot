const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/Candle\n\} from '\.\/types';/g, "Candle,\n  OptionChainSnapshot\n} from './types';");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed imports');
