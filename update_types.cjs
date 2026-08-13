const fs = require('fs');
let code = fs.readFileSync('src/backend/types.ts', 'utf8');

// Add MAX_OPTION_LOSS_PERCENT
if (!code.includes('MAX_OPTION_LOSS_PERCENT?: number;')) {
    code = code.replace(/MAX_OPTION_SPREAD_PERCENT\?: number;/, 'MAX_OPTION_SPREAD_PERCENT?: number;\n  MAX_OPTION_LOSS_PERCENT?: number;');
}

// Add wallOiHistory and wallStableByKey to StrategySessionState
if (!code.includes('wallOiHistory?: Record<string, number[]>;')) {
    code = code.replace(/export interface StrategySessionState \{/, 'export interface StrategySessionState {\n  wallOiHistory?: Record<string, number[]>;\n  wallStableByKey?: Record<string, boolean>;');
}

fs.writeFileSync('src/backend/types.ts', code);
