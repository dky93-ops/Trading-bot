const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

code = code.replace(
`  private maxErrorsBeforeExit = 10; // ~30 seconds if polling every 3s
  private optionChainCache: Record<string, { timestamp: number, data: any }> = {};`,
`  private maxErrorsBeforeExit = 10; // ~30 seconds if polling every 3s
  private lastSyncedMinuteBucket = 0;
  private candleSyncBackoffUntil = 0;
  private optionChainCache: Record<string, { timestamp: number, data: any }> = {};`
);

code = code.replace(
`  private async syncHistoricalCandles() {
    if (!this.settings.accessToken) return;
    try {
      console.log("Syncing historical intraday candles to bootstrap engine...");
      // Fetch 5-minute candles for the last day
      const response = await axios.get('https://api.upstox.com/v2/historical-candle/intraday/NSE_INDEX%7CNifty%2050/1minute', {
        headers: {
          'Accept': 'application/json',
          'Authorization': \`Bearer \${this.settings.accessToken}\`
        }
      });
      if (response.data && response.data.status === 'success' && response.data.data && response.data.data.candles) {
        await seedHistoricalCandles('NIFTY', 5, response.data.data.candles);
        await seedHistoricalCandles('NIFTY', 1, response.data.data.candles);
        await seedHistoricalCandles('NIFTY', 3, response.data.data.candles);
        console.log("Historical candles seeded successfully.");
      }
    } catch(e) {
      console.error("Failed to seed historical candles:", e.message);
    }
  }`,
`  private async syncHistoricalCandles() {
    if (!this.settings.accessToken) return;
    if (Date.now() < this.candleSyncBackoffUntil) return;
    try {
      const response = await axios.get(
        'https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/1',
        {
          headers: {
            'Accept': 'application/json',
            'Authorization': \`Bearer \${this.settings.accessToken}\`
          },
          timeout: 5000
        }
      );
      if (response.data && response.data.status === 'success' && response.data.data && response.data.data.candles) {
        const rawCandles = response.data.data.candles;
        await seedHistoricalCandles('NIFTY', 1, rawCandles);
        await seedHistoricalCandles('NIFTY', 3, rawCandles);
        await seedHistoricalCandles('NIFTY', 5, rawCandles);
        await seedHistoricalCandles('NIFTY', 15, rawCandles);
      }
    } catch(e: any) {
      if (e.response?.status === 429) {
        this.candleSyncBackoffUntil = Date.now() + 10000;
      }
      console.error("Failed to sync historical candles:", e.response?.data || e.message);
    }
  }`
);

code = code.replace(
`      this.strategyEngine.isMarketOpen() &&
      freshSpot
    ) {
      const newSignals = await this.strategyEngine.onTick(this.state);`,
`      this.strategyEngine.isMarketOpen() &&
      freshSpot
    ) {
      const currentMinuteBucket = Math.floor(Date.now() / 60000) * 60000;
      if (currentMinuteBucket !== this.lastSyncedMinuteBucket) {
        this.lastSyncedMinuteBucket = currentMinuteBucket;
        await this.syncHistoricalCandles();
      }

      const newSignals = await this.strategyEngine.onTick(this.state);`
);

fs.writeFileSync('src/backend/upstox-service.ts', code);
