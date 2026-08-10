const fs = require('fs');
let code = fs.readFileSync('src/backend/types.ts', 'utf8');

// Add config fields to AppSettings
code = code.replace(/expiryDate: string;/, "expiryDate: string;\n  WALL_TOLERANCE_POINTS?: number;\n  OPENING_RANGE_MINUTES?: number;");

// Update StrategySessionState with tracking variables
const stateAdditions = `
  // Failed setup tracking
  last_failed_setup_level: number | null;
  last_failed_setup_direction: 'CALL' | 'PUT' | null;
  last_failed_setup_timestamp: string | null;
  
  // Trades tracking
  completedTradesCount: number;
  realizedDailyPnL: number;
  consecutiveLosingTrades: number;
  noNewTradeFlag: boolean;
`;

code = code.replace(/lastFailedSetupLevel: number \| null;/, stateAdditions);

fs.writeFileSync('src/backend/types.ts', code);
