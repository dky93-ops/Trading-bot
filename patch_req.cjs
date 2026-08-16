const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-requirements.ts', 'utf8');
code = code.replace("id: 'FR-01',\n    strategy: 'FAILED_RETEST',\n    description: 'Breakout must be followed by a valid retest within four candles.',\n    status: 'ASSUMPTION',", 
"id: 'FR-01',\n    strategy: 'FAILED_RETEST',\n    description: 'Breakout must be followed by a valid retest within four candles.',\n    status: 'IMPLEMENTED',");
fs.writeFileSync('src/backend/strategy-requirements.ts', code);
