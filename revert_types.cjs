const fs = require('fs');
let types = fs.readFileSync('src/backend/types.ts', 'utf8');
types = types.replace(/export interface InternalSignal \{[\s\S]*?id: string;/m, 'export interface InternalSignal extends EngineDecision {\n  id: string;');
fs.writeFileSync('src/backend/types.ts', types);
