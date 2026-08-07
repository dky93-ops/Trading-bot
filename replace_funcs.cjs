const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

code = code.replace(/public disconnect\(\) \{[\s\S]*?private handlePollError\(\) \{/g, 
`public disconnect() {
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

  private handlePollError() {`);

code = code.replace(/private handlePollError\(\) \{[\s\S]*?private updatePnL\(\) \{/g,
`private handlePollError() {
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

  private updatePnL() {`);

// Actually, we don't need updatePnL() anymore, it is obsolete since strategy-engine tracks it.
code = code.replace(/private updatePnL\(\) \{[\s\S]*?private recordOptionChainSnapshot/g,
`private recordOptionChainSnapshot`);

fs.writeFileSync('src/backend/upstox-service.ts', code);
