const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// I'll search for the exact text and replace it.
const search = `    // Mark any remaining active signal in state as CLOSED
         
    }

       
      this.state.overallPnL = this.strategyEngine.overallPnL;
      this.state.realizedPnL = this.strategyEngine.realizedPnL;
      this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
      this.state.winRate = this.strategyEngine.winRate;
      this.state.totalTrades = this.strategyEngine.totalTrades;
      this.state.winningTrades = this.strategyEngine.winningTrades;

    this.broadcastState();
  }`;

code = code.replace(search, `    this.state.overallPnL = this.strategyEngine.overallPnL;
    this.state.realizedPnL = this.strategyEngine.realizedPnL;
    this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
    this.state.winRate = this.strategyEngine.winRate;
    this.state.totalTrades = this.strategyEngine.totalTrades;
    this.state.winningTrades = this.strategyEngine.winningTrades;
    this.broadcastState();
  }`);

// There might be another place, let's just use line numbers:
const lines = code.split('\n');
// We need to fix the disconnect method block
let newLines = [];
let inDisconnect = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('public disconnect() {')) {
    inDisconnect = true;
    newLines.push(`  public disconnect() {
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
  }`);
  } else if (lines[i].includes('private handlePollError() {')) {
    inDisconnect = false;
    newLines.push(lines[i]);
  } else if (!inDisconnect) {
    newLines.push(lines[i]);
  }
}

fs.writeFileSync('src/backend/upstox-service.ts', newLines.join('\n'));
