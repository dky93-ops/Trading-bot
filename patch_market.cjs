const fs = require('fs');
let code = fs.readFileSync('src/db/market.ts', 'utf8');

const newCode = `
export async function seedHistoricalCandles(instrument: string, timeframe: number, candleData: Array<[string, number, number, number, number, number, number]>) {
  try {
    const valuesToInsert = candleData.map(c => {
      // Upstox timestamp: '2024-03-28T12:47:00+05:30'
      const timestamp = new Date(c[0]);
      return {
        instrument,
        timeframe,
        timestamp,
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4]
      };
    });

    for (const val of valuesToInsert) {
      const existing = await db.select().from(candles).where(
        and(
          eq(candles.instrument, instrument),
          eq(candles.timeframe, timeframe),
          eq(candles.timestamp, val.timestamp)
        )
      ).limit(1);

      if (existing.length === 0) {
        await db.insert(candles).values(val);
      }
    }
  } catch(e) {
    console.error("Failed to seed historical candles:", e);
  }
}
`;

if(!code.includes('seedHistoricalCandles')) {
  fs.writeFileSync('src/db/market.ts', code + newCode);
}
