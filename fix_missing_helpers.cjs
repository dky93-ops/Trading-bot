const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const helpers = `
  private getCompletedCandleKey(candle: Candle): string {
    return new Date(candle.timestamp).toISOString();
  }

  private getCompletedCandleIndexByTimestamp(candles: Candle[], timestamp: string): number {
    return candles.findIndex(c => new Date(c.timestamp).toISOString() === timestamp);
  }
`;

if (!code.includes('getCompletedCandleKey')) {
  code = code.replace(/private isMarketOpen\(\): boolean \{/, helpers + '\n  private isMarketOpen(): boolean {');
  fs.writeFileSync('src/backend/strategy-engine.ts', code);
}
