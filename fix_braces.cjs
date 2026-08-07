const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// I should fix the braces manually instead of regex.
// Wait, I can just use prettier or find the exact spot.
