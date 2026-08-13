const fs = require('fs');

let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

code = code.replace(/setHours\(14, 30, 0, 0\)/g, "setHours(15, 0, 0, 0)");

fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('PATCH 4 15:00 complete');
