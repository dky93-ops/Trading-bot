const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

code = code.replace(/this\.getNearestExpiry\.bind\(this\)\n\s*\);/, "this.getNearestExpiry.bind(this),\n      this.getOptionChainHistory.bind(this)\n    );");
fs.writeFileSync('src/backend/upstox-service.ts', code);
