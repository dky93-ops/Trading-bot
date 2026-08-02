import { db } from './index.ts';
import { ticks, candles } from './schema.ts';
import { sql, eq, and, desc, gte } from 'drizzle-orm';

export async function insertTick(instrument: string, price: number, timestamp: number) {
  try {
    await db.insert(ticks).values({
      instrument,
      price,
      timestamp: new Date(timestamp),
    });
    // Build candles
    await buildCandles(instrument, timestamp);
  } catch (error) {
    console.error("Failed to insert tick:", error);
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
      const allTicks = await db.select().from(ticks).where(
        and(
          eq(ticks.instrument, instrument),
          gte(ticks.timestamp, candleStart)
        )
      ).orderBy(ticks.timestamp);

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
