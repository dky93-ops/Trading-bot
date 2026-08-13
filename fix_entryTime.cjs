const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
code = code.replace(/entryTime: Date.now\(\) as any/g, "");
code = code.replace(/highestPrice: spot,\n\s*\}\;/g, "highestPrice: spot\n    } as any;");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
