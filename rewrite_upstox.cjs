const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// The issue is around line 499 (startPolling inner logic) to recordOptionChainSnapshot.
// Let's just fix the mismatched brackets manually by using a proper AST parser or just providing the entire functions.
// I'll replace everything from `private startPolling() {` down to `private recordOptionChainSnapshot` with known good code.
const regex = /private startPolling\(\) \{[\s\S]*?private recordOptionChainSnapshot/m;
const match = code.match(regex);
if (match) {
  code = code.replace(regex, `private startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;

    const poll = async () => {
      if (!this.isPolling) return;

      if (Date.now() < this.rateLimitBackoffUntil) {
        setTimeout(poll, 3000);
        return;
      }

      const success = await this.fetchLiveMarketQuote();
      if (!success) {
        this.handlePollError();
      } else {
        this.errorCount = 0;
      }

      if (this.settings.isTradingEnabled && this.state.isConnected && !this.state.apiError && this.strategyEngine.isMarketOpen()) {
        const now = Date.now();
        const isNiftyFresh = this.state.nifty50.timestamp > 0 && (now - this.state.nifty50.timestamp < 12000);

        if (isNiftyFresh) {
          const newSignals = await this.strategyEngine.onTick(this.state);
          if (newSignals.length > 0) {
            this.state.signals = newSignals.slice(0, 10); // Keep last 10 decisions in state
          }
        }
      }

      this.state.overallPnL = this.strategyEngine.overallPnL;
      this.state.realizedPnL = this.strategyEngine.realizedPnL;
      this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
      this.state.winRate = this.strategyEngine.winRate;
      this.state.totalTrades = this.strategyEngine.totalTrades;
      this.state.winningTrades = this.strategyEngine.winningTrades;
      this.broadcastState();

      setTimeout(poll, 1500);
    };

    poll();
  }

  private stopPolling() {
    this.isPolling = false;
  }

  public disconnect() {
    this.stopPolling();
    this.state.isConnected = false;
    this.state.apiError = "Disconnected by user";
    if (this.strategyEngine.activeSignals.size > 0) {
      this.strategyEngine.exitAllActiveTrades("User Disconnected");
    }

    this.state.overallPnL = this.strategyEngine.overallPnL;
    this.state.realizedPnL = this.strategyEngine.realizedPnL;
    this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
    this.state.winRate = this.strategyEngine.winRate;
    this.state.totalTrades = this.strategyEngine.totalTrades;
    this.state.winningTrades = this.strategyEngine.winningTrades;
    this.broadcastState();
  }

  private handlePollError() {
    this.errorCount++;
    this.state.isConnected = false;

    if (this.errorCount >= 3) {
      if (this.strategyEngine.activeSignals.size > 0) {
        console.warn(\`Upstox connection lost for \${this.errorCount * 1.5}s. Exiting all active trades.\`);
        this.strategyEngine.exitAllActiveTrades("Upstox Connection Lost");
      }
    }

    this.state.overallPnL = this.strategyEngine.overallPnL;
    this.state.realizedPnL = this.strategyEngine.realizedPnL;
    this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
    this.state.winRate = this.strategyEngine.winRate;
    this.state.totalTrades = this.strategyEngine.totalTrades;
    this.state.winningTrades = this.strategyEngine.winningTrades;
    this.broadcastState();
  }

  private recordOptionChainSnapshot`);

  fs.writeFileSync('src/backend/upstox-service.ts', code);
}
