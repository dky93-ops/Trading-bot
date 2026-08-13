const fs = require('fs');

let types = fs.readFileSync('src/backend/types.ts', 'utf8');
types = types.replace(/export interface ProposedSetup \{/, "export interface ProposedSetup {\n  ivAvg?: number;\n  ivPenalty?: number;");
fs.writeFileSync('src/backend/types.ts', types);
console.log('PATCH 4 types complete');
