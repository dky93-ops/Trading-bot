const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/lastFailedSetupLevel: null,/g, "last_failed_setup_level: null,\n      last_failed_setup_direction: null,\n      last_failed_setup_timestamp: null,\n      completedTradesCount: 0,\n      realizedDailyPnL: 0,\n      consecutiveLosingTrades: 0,\n      noNewTradeFlag: false,");

code = code.replace(/sessState\.lastFailedSetupLevel = /g, "sessState.last_failed_setup_level = ");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
