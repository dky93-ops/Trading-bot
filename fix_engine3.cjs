const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/import \{ AppSettings, AppState, Candle, OptionChainSnapshot, InternalSignal, StrategySessionState, EngineDecision, TradingSymbol \} from '\.\/types';/g,
"import { AppSettings, AppState, Candle, OptionChainSnapshot, StrategySessionState, EngineDecision, TradingSymbol, InternalSignal } from './types';");

// The previous `code.replace(/: Signal /g, ": InternalSignal ")` changed things like `Promise<Signal[]>` to `Promise<InternalSignal[]>`.
// But `onTick` returns `EngineDecision[]`. Let's ensure that.
code = code.replace(/public async onTick\(newState: AppState\): Promise\<InternalSignal\[\]\> \{/g, 
"public async onTick(newState: AppState): Promise<EngineDecision[]> {");

code = code.replace(/activeSignals = new Map\<string, InternalSignal\>\(\);/g, 
`public activeSignals = new Map<string, InternalSignal>();
  public overallPnL: number = 0;
  public realizedPnL: number = 0;
  public unrealizedPnL: number = 0;
  public winRate: number = 0;
  public totalTrades: number = 0;
  public winningTrades: number = 0;`);

// Fix `nearestCEWallAbove` and `nearestPEWallBelow`
code = code.replace(/sessState\.nearestCEWallAbove/g, "sessState.nearestCeWallAbove");
code = code.replace(/sessState\.nearestPEWallBelow/g, "sessState.nearestPeWallBelow");
code = code.replace(/nearestCEWallAbove:/g, "nearestCeWallAbove:");
code = code.replace(/nearestPEWallBelow:/g, "nearestPeWallBelow:");

// Replace `Signal` where still missing
code = code.replace(/<Signal>/g, "<InternalSignal>");
code = code.replace(/<Signal \|/g, "<InternalSignal |");
code = code.replace(/: Signal /g, ": InternalSignal ");

fs.writeFileSync('src/backend/strategy-engine.ts', code);

// In validation-rules.ts, fix `Signal`
let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
valCode = valCode.replace(/import \{ Candle, ProposedSetup, InternalSignal \} from '\.\/types';/g, 
"import { Candle, ProposedSetup } from './types';");
fs.writeFileSync('src/backend/validation-rules.ts', valCode);

let upstoxCode = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');
upstoxCode = upstoxCode.replace(/import \{ AppSettings, AppState, OptionChainSnapshot, TradingSymbol, InternalSignal \} from '\.\/types';/g,
"import { AppSettings, AppState, OptionChainSnapshot, TradingSymbol } from './types';");
fs.writeFileSync('src/backend/upstox-service.ts', upstoxCode);
