const fs = require('fs');
let types = fs.readFileSync('src/backend/types.ts', 'utf8');
types = types.replace(/export interface StrategySessionState \{/, "export interface StrategySessionState {\n  feedSyncPenalty?: number;");
types = types.replace(/export interface ProposedSetup \{/, "export interface ProposedSetup {\n  earlyWindow?: boolean;\n  earlyStrongWindow?: boolean;");
fs.writeFileSync('src/backend/types.ts', types);

let strat = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
strat = strat.replace(/setup\.feedSyncPenalty = 0; \/\/ or any logic/, "setup.feedSyncPenalty = valCtx.sessState.feedSyncPenalty || 0;");
fs.writeFileSync('src/backend/strategy-engine.ts', strat);
console.log('Fixed feedsync type');
