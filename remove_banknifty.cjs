const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');
code = code.replace(/this\.state\.bankNifty\.lastPrice = spot;\n\s*this\.state\.bankNifty\.timestamp = Date\.now\(\);/g, "");
fs.writeFileSync('src/backend/upstox-service.ts', code);

let code2 = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
code2 = code2.replace(/const currentSpot = signal\.index === 'NIFTY' \? this\.state\.nifty50\.lastPrice : this\.state\.bankNifty\?\.lastPrice \|\| 0;/g, "const currentSpot = this.state.nifty50.lastPrice;");
fs.writeFileSync('src/backend/strategy-engine.ts', code2);
