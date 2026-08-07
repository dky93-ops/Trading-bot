const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/public activeSignals: Map\<string, InternalSignal\> = new Map\(\);/,
`public activeSignals: Map<string, InternalSignal> = new Map();
  public overallPnL: number = 0;
  public realizedPnL: number = 0;
  public unrealizedPnL: number = 0;
  public winRate: number = 0;
  public totalTrades: number = 0;
  public winningTrades: number = 0;`);

// In strategy-engine.ts:
// error TS2304: Cannot find name 'Signal'.
// Let's replace any `Signal` with `InternalSignal` as a whole word
code = code.replace(/\bSignal\b/g, "InternalSignal");

// In validation-rules.ts:
// error TS2305: Module '"./types.js"' has no exported member 'ProposedSetup'.
// ProposedSetup is defined in validation-rules.ts itself! It shouldn't be imported from types.js.
let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
valCode = valCode.replace(/import \{.*?\} from '\.\/types\.js';/, "import { Candle, StrategySessionState, InternalSignal } from './types.js';");
valCode = valCode.replace(/\bInternalInternalSignal\b/g, "InternalSignal"); // Fix previous double replace
valCode = valCode.replace(/\bSignal\b/g, "InternalSignal");
fs.writeFileSync('src/backend/validation-rules.ts', valCode);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
