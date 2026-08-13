const fs = require('fs');
let code = fs.readFileSync('src/backend/types.ts', 'utf8');

// AppSettings addition
const appSettingsAddition = `  DECISION_TIMEFRAME_MINUTES?: number;
  MAX_OPTION_SPREAD_PERCENT?: number;
  PREMIUM_CONFIRMATION_PERCENT?: number;
  OPENING_PREMIUM_CONFIRMATION_PERCENT?: number;
  WALL_OI_RATIO?: number;
  WALL_WEAKENING_PERCENT?: number;
  MAX_WALL_DISTANCE_ATR?: number;
  MIN_ENTRY_TIME_IST?: string;
  LAST_ENTRY_TIME_IST?: string;`;

code = code.replace(
  "  maxActiveTrades?: number;",
  "  maxActiveTrades?: number;\n" + appSettingsAddition
);

// Add SignalPrices interface
const signalPrices = `export interface SignalPrices {
  spotEntry: number;
  spotInvalidation: number;
  spotTarget1: number;
  spotTarget2: number;
  optionEntry: number;
  optionStoploss: number;
  optionTarget1: number;
  optionTarget2: number;
}`;
code = code.replace("export interface EngineDecision {", signalPrices + "\n\nexport interface EngineDecision {");

// Add fields to EngineDecision
const engineDecisionAddition = `  spot_entry?: number;
  spot_invalidation?: number;
  spot_target1?: number;
  spot_target2?: number;
  option_entry?: number;
  option_stoploss?: number;
  option_target1?: number;
  option_target2?: number;`;

code = code.replace(
  "  fake_signal_filters_failed: string[];\n}",
  "  fake_signal_filters_failed: string[];\n" + engineDecisionAddition + "\n}"
);

// Add fields to InternalSignal
const internalSignalAddition = `  prices: SignalPrices;
  spotEntry: number;
  spotInvalidation: number;
  spotTarget1: number;
  spotTarget2: number;
  optionEntry: number;
  optionStoploss: number;
  optionTarget1: number;
  optionTarget2: number;
  latestSpot?: number;
  latestSpotTimestamp?: number;
  latestOptionTimestamp?: number;`;

code = code.replace(
  "  id: string;",
  internalSignalAddition + "\n  id: string;"
);

fs.writeFileSync('src/backend/types.ts', code);
console.log('types.ts updated');
