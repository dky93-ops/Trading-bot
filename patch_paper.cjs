const fs = require('fs');

let upstoxCode = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');
const paperModeMethod = `
  private isPaperTradingOnly(): boolean {
    return (
      String(process.env.PAPER_TRADING_ONLY || '')
        .trim()
        .toLowerCase() === 'true'
    );
  }
`;

if (!upstoxCode.includes('isPaperTradingOnly')) {
  upstoxCode = upstoxCode.replace('private async syncHistoricalCandles() {', paperModeMethod + '\n  private async syncHistoricalCandles() {');
}

const paperCheck = `if (!this.isPaperTradingOnly()) {
      this.state.apiError =
        'Blocked: PAPER_TRADING_ONLY must be true.';

      this.state.signals = [];
      this.strategyEngine.exitAllActiveTrades(
        'Paper-trading safety gate',
      );

      this.broadcastState();
      return;
    }

    if (this.isPolling) return;`;

upstoxCode = upstoxCode.replace('if (this.isPolling) return;', paperCheck);
fs.writeFileSync('src/backend/upstox-service.ts', upstoxCode);

let envExample = fs.readFileSync('.env.example', 'utf8');
if (!envExample.includes('PAPER_TRADING_ONLY')) {
  envExample += '\nPAPER_TRADING_ONLY=true\n';
  fs.writeFileSync('.env.example', envExample);
}

let engineCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
const safetyNoTrade = `
  public createSafetyNoTrade(
    index: string,
    spot: number,
  ): EngineDecision {
    return this.createNoTrade(
      index,
      spot,
      'BLOCKED_PAPER_MODE: PAPER_TRADING_ONLY must be true',
    );
  }
`;
if (!engineCode.includes('createSafetyNoTrade')) {
  engineCode = engineCode.replace('private createNoTrade', safetyNoTrade + '\n  private createNoTrade');
  fs.writeFileSync('src/backend/strategy-engine.ts', engineCode);
}
