const fs = require('fs');
let file = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

file = file.replace(/25 \* lots/g, '75 * lots');

fs.writeFileSync('src/backend/upstox-service.ts', file);
