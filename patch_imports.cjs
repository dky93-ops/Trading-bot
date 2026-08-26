const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');
code = code.replace("import { computeATR } from './technical-indicators';", "import { computeATR, computeSMA, computeEMA } from './technical-indicators';");
fs.writeFileSync('src/backend/validation-rules.ts', code);
