const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/import \{ AppSettings, AppState, Candle, OptionChainSnapshot, InternalSignal, StrategySessionState, EngineDecision, TradingSymbol \} from '\.\/types';/g,
"import { AppSettings, AppState, Candle, OptionChainSnapshot, InternalSignal, StrategySessionState, EngineDecision, TradingSymbol } from './types';");

// Need to fix all occurrences of `Promise<Signal | null>` to `Promise<InternalSignal | null>`
// Need to fix all occurrences of `Signal` to `InternalSignal` except in AppState signals (which is EngineDecision)
code = code.replace(/: Signal /g, ": InternalSignal ");
code = code.replace(/: Signal\[/g, ": InternalSignal[");
code = code.replace(/<Signal>/g, "<InternalSignal>");
code = code.replace(/<Signal \|/g, "<InternalSignal |");

// Fix nearestCEWallAbove -> nearestCeWallAbove and nearestPEWallBelow -> nearestPeWallBelow in StrategySessionState instantiation
code = code.replace(/nearestCEWallAbove:/g, "nearestCeWallAbove:");
code = code.replace(/nearestPEWallBelow:/g, "nearestPeWallBelow:");

fs.writeFileSync('src/backend/strategy-engine.ts', code);

let upstoxCode = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');
upstoxCode = upstoxCode.replace(/import \{ AppSettings, AppState, OptionChainSnapshot, TradingSymbol \} from '\.\/types';/g, 
"import { AppSettings, AppState, OptionChainSnapshot, TradingSymbol, InternalSignal } from './types';");
upstoxCode = upstoxCode.replace(/import \{ AppSettings, AppState, OptionChainSnapshot \} from '\.\/types';/g, 
"import { AppSettings, AppState, OptionChainSnapshot, TradingSymbol, InternalSignal } from './types';");

// Fix `private async fetchOptionData(index: string` in upstox
upstoxCode = upstoxCode.replace(/private async fetchOptionData\(index: string,/g, "private async fetchOptionData(index: TradingSymbol,");


// Upstox PnL calculation: it was using this.state.signals.
// Now that this.state.signals is EngineDecision[], let's change upstox-service so it doesn't manipulate `state.signals` for PnL.
// Instead, `strategyEngine.onTick` should calculate PnL and upstox-service should just read it.
upstoxCode = upstoxCode.replace(/for \(const sig of newSignals\) \{[\s\S]*?\}\n        \}/, 
`this.state.signals = newSignals.slice(0, 10); // Keep last 10 decisions in state`);

// Let's remove the whole `recordMetrics` in upstox if it accesses status
upstoxCode = upstoxCode.replace(/this\.state\.signals\.forEach\(s => \{[\s\S]*?\}\);/g, `
      // Read stats from strategy engine
      this.state.overallPnL = this.strategyEngine.overallPnL;
      this.state.realizedPnL = this.strategyEngine.realizedPnL;
      this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
      this.state.winRate = this.strategyEngine.winRate;
      this.state.totalTrades = this.strategyEngine.totalTrades;
      this.state.winningTrades = this.strategyEngine.winningTrades;
`);

fs.writeFileSync('src/backend/upstox-service.ts', upstoxCode);

let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
valCode = valCode.replace(/import \{ Candle, ProposedSetup, Signal \} from '\.\/types';/g, 
"import { Candle, ProposedSetup, InternalSignal } from './types';");
fs.writeFileSync('src/backend/validation-rules.ts', valCode);
