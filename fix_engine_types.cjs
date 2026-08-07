const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/Promise\<Signal\[\]\>/g, "Promise<EngineDecision[]>");
code = code.replace(/const newSignals: Signal\[\] = \[\];/g, "const decisions: EngineDecision[] = [];\n    const newSignals: InternalSignal[] = [];");
code = code.replace(/import \{ AppSettings, AppState, Candle, OptionChainSnapshot, Signal, StrategySessionState, EngineDecision \} from '\.\/types';/g, "import { AppSettings, AppState, Candle, OptionChainSnapshot, InternalSignal, StrategySessionState, EngineDecision, TradingSymbol } from './types';");
code = code.replace(/activeSignals = new Map\<string, Signal\>\(\);/g, "activeSignals = new Map<string, InternalSignal>();");
code = code.replace(/public async onTick\(newState: AppState\): Promise\<EngineDecision\[\]\> \{[\s\S]*?return newSignals;\n  \}/g,
`public async onTick(newState: AppState): Promise<EngineDecision[]> {
    this.state = newState;
    const newSignals: InternalSignal[] = [];
    const decisions: EngineDecision[] = [];

    // If global trading toggle is disabled or market is closed, exit active trades and return
    if (!this.settings.isTradingEnabled || !this.isMarketOpen()) {
      if (this.activeSignals.size > 0) {
        this.exitAllActiveTrades(
          !this.settings.isTradingEnabled 
            ? "Trading Paused" 
            : "Market Closed (Outside NSE Trading Hours 09:15 - 15:30 IST)"
        );
      }
      return decisions;
    }

    // Manage active trades first
    this.manageActiveTrades(newSignals);

    // Evaluate NIFTY ONLY
    if (this.state.nifty50.lastPrice > 0) {
      const sig = await this.evaluateIndex('NIFTY', this.state.nifty50.lastPrice);
      if (sig) {
        if (sig.signal !== 'NO_TRADE') {
          newSignals.push(sig);
          decisions.push(this.mapToPublicDecision(sig));
        } else {
          decisions.push(this.mapToPublicDecision(sig));
        }
      }
    }

    newSignals.forEach(s => this.activeSignals.set(s.id, s));
    return decisions;
  }`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
