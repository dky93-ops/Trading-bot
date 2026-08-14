const fs = require('fs');
let code = fs.readFileSync('src/db/market.ts', 'utf8');

const newCode = `
export async function seedHistoricalCandles(instrument: string, timeframe: number, candleData: Array<[string, number, number, number, number, number, number]>) {
  try {
    const rawCandles = candleData.map(c => {
      return {
        timestamp: new Date(c[0]),
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4]
      };
    });
    
    // Sort chronologically
    rawCandles.sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Build candles of target timeframe from 1-min raw data
    const tfMs = timeframe * 60 * 1000;
    const aggregated = new Map<number, any>();
    
    for (const c of rawCandles) {
       const bucketStartMs = Math.floor(c.timestamp.getTime() / tfMs) * tfMs;
       if (!aggregated.has(bucketStartMs)) {
         aggregated.set(bucketStartMs, {
           instrument, timeframe,
           timestamp: new Date(bucketStartMs),
           open: c.open, high: c.high, low: c.low, close: c.close
         });
       } else {
         const existing = aggregated.get(bucketStartMs);
         existing.high = Math.max(existing.high, c.high);
         existing.low = Math.min(existing.low, c.low);
         existing.close = c.close;
       }
    }

    const valuesToInsert = Array.from(aggregated.values());

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

// Replace the previous implementation completely
code = code.replace(/export async function seedHistoricalCandles[\s\S]*?\}\n\}\n/, newCode);

fs.writeFileSync('src/db/market.ts', code);
