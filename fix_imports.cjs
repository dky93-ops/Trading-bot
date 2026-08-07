const fs = require('fs');

const files = ['src/backend/strategy-engine.ts', 'src/backend/upstox-service.ts', 'src/backend/validation-rules.ts'];

for (const f of files) {
  let code = fs.readFileSync(f, 'utf8');
  
  // Re-run the replacements but match optional `.js`
  // Actually, I can just do a regex replace to catch any `Signal` and replace with `InternalSignal`.
  
  if (f === 'src/backend/strategy-engine.ts') {
    code = code.replace(/import \{.*?\} from '\.\/types\.js';/, "import { AppSettings, AppState, Candle, OptionChainSnapshot, StrategySessionState, EngineDecision, TradingSymbol, InternalSignal } from './types.js';");
  }
  
  if (f === 'src/backend/upstox-service.ts') {
    code = code.replace(/import \{.*?\} from '\.\/types\.js';/, "import { AppSettings, AppState, OptionChainSnapshot, TradingSymbol, InternalSignal } from './types.js';");
  }
  
  if (f === 'src/backend/validation-rules.ts') {
    code = code.replace(/import \{.*?\} from '\.\/types\.js';/, "import { Candle, ProposedSetup, InternalSignal, StrategySessionState } from './types.js';");
    code = code.replace(/Signal/g, "InternalSignal");
  }

  fs.writeFileSync(f, code);
}
