const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const initRegex = /wallInvalidForRejection: \{\},/m;
const initRep = "wallInvalidForRejection: {},\n      totalTradesToday: 0,\n      consecutiveLosses: 0,";
code = code.replace(initRegex, initRep);
fs.writeFileSync('src/backend/strategy-engine.ts', code);

let types = fs.readFileSync('src/backend/types.ts', 'utf8');
types = types.replace(/export interface StrategySessionState \{/, "export interface StrategySessionState {\n  totalTradesToday: number;\n  consecutiveLosses: number;");
fs.writeFileSync('src/backend/types.ts', types);
console.log('PATCH 6 session limits init complete');
