const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

if (!engine.includes('oiChange?: number;')) {
  engine = engine.replace(/type: 'CE' \| 'PE';/g, "type: 'CE' | 'PE';\n  oiChange?: number;");
}

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
