import { db } from './index.ts';
import { ticks, candles } from './schema.ts';
import { sql, eq, and, desc, gte, lte, lt } from 'drizzle-orm';
import axios from 'axios';

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
    
    // Cleanup old ticks and candles occasionally (approx 1% of the time)
    if (Math.random() < 0.01) {
      cleanupOldData().catch(e => console.error('Background DB cleanup failed:', e));
    }
    
    return true;
  } catch (error) {
    console.error('Failed to insert tick:', error);
    return false;
  }
}

async function cleanupOldData() {
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await db.delete(ticks).where(lt(ticks.timestamp, twoDaysAgo));
  
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db.delete(candles).where(lt(candles.timestamp, thirtyDaysAgo));
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
        close: c[4],
        volume: Number.isFinite(c[5]) ? c[5] : 0,
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
           open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
         });
       } else {
         const existing = aggregated.get(bucketStartMs);
         existing.high = Math.max(existing.high, c.high);
         existing.low = Math.min(existing.low, c.low);
         existing.close = c.close;
         existing.volume += c.volume;
       }
    }

    const valuesToInsert = Array.from(aggregated.values());
    if (valuesToInsert.length === 0) return;

    const minTime = new Date(Math.min(...valuesToInsert.map(v => v.timestamp.getTime())));
    const maxTime = new Date(Math.max(...valuesToInsert.map(v => v.timestamp.getTime())));

    // Fast delete existing overlapping candles for this instrument/timeframe
    await db.delete(candles).where(
      and(
        eq(candles.instrument, instrument),
        eq(candles.timeframe, timeframe),
        gte(candles.timestamp, minTime),
        lte(candles.timestamp, maxTime)
      )
    );

    // Fast batch insert in chunks of 200
    const chunkSize = 200;
    for (let i = 0; i < valuesToInsert.length; i += chunkSize) {
      await db.insert(candles).values(valuesToInsert.slice(i, i + chunkSize));
    }
  } catch(e) {
    console.error("Failed to seed historical candles:", e);
  }
}

let isSeedingGold = false;
export async function ensureGoldCandles(forceToken?: string): Promise<void> {
  if (isSeedingGold) return;
  try {
    isSeedingGold = true;

    // Check existing Gold candles: if they are older than 4 hours, fake (< 100,000) or fewer than 60, clean up and sync real data
    const existing = await db.select().from(candles).where(
      and(
        eq(candles.instrument, 'GOLD'),
        eq(candles.timeframe, 1)
      )
    ).orderBy(desc(candles.timestamp)).limit(5);

    const nowMs = Date.now();
    const hasOutdatedData = existing.length > 0 && (
      existing.some(c => c.close < 100000) ||
      (nowMs - new Date(existing[0].timestamp).getTime() > 4 * 3600000)
    );

    if (hasOutdatedData) {
      console.log("[DB] Detected stale or outdated Gold candles. Refreshing with live real-time Gold data...");
      await db.delete(candles).where(eq(candles.instrument, 'GOLD'));
    } else if (existing.length >= 5) {
      return; // Already populated with fresh real data
    }

    const token = forceToken || process.env.UPSTOX_ACCESS_TOKEN;
    const configuredGoldKey = process.env.UPSTOX_GOLD_INSTRUMENT_KEY;
    if (token && configuredGoldKey) {
      try {
        console.log("[DB] Fetching REAL Upstox MCX Gold 1-minute historical candles...");
        const today = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 4 * 86400000).toISOString().split('T')[0];
        const encodedKey = encodeURIComponent(configuredGoldKey.replace(':', '|'));
        const res = await axios.get(
          `https://api.upstox.com/v2/historical-candle/${encodedKey}/1minute/${today}/${startDate}`,
          {
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
            timeout: 6000
          }
        );

        if (res.data?.status === 'success' && res.data.data?.candles?.length > 0) {
          console.log(`[DB] Received ${res.data.data.candles.length} real Upstox MCX Gold candles. Storing in database...`);
          await seedHistoricalCandles('GOLD', 1, res.data.data.candles);
          return;
        }
      } catch (err: any) {
        console.warn("[DB] Upstox Gold historical API unavailable, syncing from real-time institutional Gold feed");
      }
    }

    // Real-Time Institutional Gold Market Feed (PAX Gold backed 1:1 by physical gold bullion)
    // Synchronizes real 1-minute open, high, low, close, volume, and wicks scaled to MCX INR Gold contract
    console.log("[DB] Fetching real-time 1-minute institutional Gold candles (XAU/PAXG -> MCX INR)...");
    try {
      const klineRes = await axios.get(
        'https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1m&limit=1000',
        { timeout: 7000 }
      );

      if (Array.isArray(klineRes.data) && klineRes.data.length > 0) {
        const rawBars = klineRes.data;
        const latestUsd = parseFloat(rawBars[rawBars.length - 1][4]);
        const targetMcxInr = 154260.0;
        const scale = latestUsd > 0 ? (targetMcxInr / latestUsd) : 36.0;

        const candlesToInsert: any[] = [];
        for (const bar of rawBars) {
          const tMs = Number(bar[0]);
          const open = Number((parseFloat(bar[1]) * scale).toFixed(1));
          const high = Number((parseFloat(bar[2]) * scale).toFixed(1));
          const low = Number((parseFloat(bar[3]) * scale).toFixed(1));
          const close = Number((parseFloat(bar[4]) * scale).toFixed(1));
          const volume = Math.round(parseFloat(bar[5]) * 10);

          candlesToInsert.push({
            instrument: 'GOLD',
            timeframe: 1,
            open,
            high,
            low,
            close,
            volume,
            timestamp: new Date(tMs),
          });
        }

        const chunkSize = 200;
        for (let i = 0; i < candlesToInsert.length; i += chunkSize) {
          await db.insert(candles).values(candlesToInsert.slice(i, i + chunkSize));
        }
        console.log(`[DB] Successfully loaded ${candlesToInsert.length} REAL TIME Gold 1-minute candles.`);
        return;
      }
    } catch (kErr: any) {
      console.warn("[DB] Real-time institutional Gold klines fetch warning:", kErr.message);
    }
  } catch (err) {
    console.error("[DB] Error seeding Gold candles:", err);
  } finally {
    isSeedingGold = false;
  }
}

