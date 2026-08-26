const fs = require('fs');
let code = fs.readFileSync('src/backend/types.ts', 'utf-8');
if (!code.includes('entryTime?: number;')) {
  code = code.replace("latestOptionTimestamp?: number;", "latestOptionTimestamp?: number;\n  entryTime?: number;");
  fs.writeFileSync('src/backend/types.ts', code);
}
