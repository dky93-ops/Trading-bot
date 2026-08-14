const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

code = code.replace("import { insertTick } from '../db/market.js';", "import { insertTick, seedHistoricalCandles } from '../db/market.js';");

const newMethod = `
  private async syncHistoricalCandles() {
    if (!this.settings.accessToken) return;
    try {
      console.log("Syncing historical intraday candles to bootstrap engine...");
      // Fetch 5-minute candles for the last day
      const response = await axios.get('https://api.upstox.com/v2/historical-candle/intraday/NSE_INDEX%7CNifty%2050/5minute', {
        headers: {
          'Accept': 'application/json',
          'Authorization': \`Bearer \${this.settings.accessToken}\`
        }
      });
      if (response.data && response.data.status === 'success' && response.data.data && response.data.data.candles) {
        await seedHistoricalCandles('NIFTY', 5, response.data.data.candles.reverse());
        console.log("Historical candles seeded successfully.");
      }
    } catch(e) {
      console.error("Failed to seed historical candles:", e.message);
    }
  }

  public async startPolling() {
`;

code = code.replace("public startPolling() {", newMethod);
code = code.replace("console.log(\"Starting Upstox Market Data Polling...\");", "console.log(\"Starting Upstox Market Data Polling...\");\n    this.syncHistoricalCandles().catch(console.error);");

fs.writeFileSync('src/backend/upstox-service.ts', code);
