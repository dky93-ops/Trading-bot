const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
engine = engine.replace(/private createNoTrade\(index: string, spot: number, reason: string\): EngineDecision/g, 'private createNoTrade(index: string, spot: number, reason: string): any');
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
