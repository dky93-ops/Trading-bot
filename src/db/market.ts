import { db } from './index.ts';
import { ticks, candles } from './schema.ts';
import { sql, eq, and, desc, gte, lt } from 'drizzle-orm';

export async function insertTick(
  instrument: string,
  price: number,
  timestamp: number,
): Promise<boolean> {
  if (
    !instrument ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(timestamp)
  ) {
    return false;
  }
  try {
    await db.insert(ticks).values({
      instrument,
      price,
      timestamp: new Date(timestamp),
    });
    await buildCandles(instrument, timestamp);
    return true;
  } catch (error) {
    console.error('Failed to insert tick:', error);
    return false;
  }
}

async function buildCandles(instrument: string, currentTimestamp: number) {
  const timeframes = [1, 3, 5, 15]; // in minutes
  for (const tf of timeframes) {
    const tfMs = tf * 60 * 1000;
    const candleStart = new Date(Math.floor(currentTimestamp / tfMs) * tfMs);
    const candleEnd = new Date(candleStart.getTime() + tfMs);

    try {
      // Find existing candle
      const existing = await db.select().from(candles).where(
        and(
          eq(candles.instrument, instrument),
          eq(candles.timeframe, tf),
          eq(candles.timestamp, candleStart)
        )
      ).limit(1);

      // Get all ticks for this candle
      const allTicks = await db
        .select()
        .from(ticks)
        .where(
          and(
            eq(ticks.instrument, instrument),
            gte(ticks.timestamp, candleStart),
            lt(ticks.timestamp, candleEnd),
          ),
        )
        .orderBy(ticks.timestamp);

      if (allTicks.length === 0) continue;

      const open = allTicks[0].price;
      const close = allTicks[allTicks.length - 1].price;
      let high = allTicks[0].price;
      let low = allTicks[0].price;

      for (const t of allTicks) {
        if (t.price > high) high = t.price;
        if (t.price < low) low = t.price;
      }

      if (existing.length > 0) {
        // Update candle
        await db.update(candles).set({
          open, high, low, close
        }).where(eq(candles.id, existing[0].id));
      } else {
        // Insert candle
        await db.insert(candles).values({
          instrument,
          timeframe: tf,
          open, high, low, close,
          timestamp: candleStart
        });
      }
    } catch (e) {
      console.error(`Failed to build ${tf}m candle for ${instrument}:`, e);
    }
  }
}

export async function getCandles(instrument: string, timeframe: number, limit: number = 100) {
  try {
    return await db.select().from(candles).where(
      and(
        eq(candles.instrument, instrument),
        eq(candles.timeframe, timeframe)
      )
    ).orderBy(desc(candles.timestamp)).limit(limit);
  } catch (e) {
    console.error("Failed to get candles:", e);
    return [];
  }
}


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
