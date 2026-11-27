import { db, createPool } from './index.ts';
import { ticks, candles } from './schema.ts';
import { sql, eq, and, desc, asc, gte, lte, lt } from 'drizzle-orm';
import axios from 'axios';

/**
 * Checks whether a given timestamp falls strictly within genuine NSE market trading hours.
 * - NSE (NIFTY): Monday - Friday 09:15 AM to 03:30 PM IST (Candles from 09:15 up to 15:29).
 * Weekends (Saturday and Sunday) and non-market hours are strictly excluded.
 */
export function isMarketHours(timestamp: Date | number | string): boolean {
  const d = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(d.getTime())) return false;

  // Shift UTC to IST (+5 hours 30 minutes = +19800000 ms)
  const istDate = new Date(d.getTime() + 19800000);
  const day = istDate.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false; // Absolutely no trading on Saturday / Sunday

  const totalMins = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  // NSE Trading Hours: 09:15 AM (555 mins) to 03:30 PM (930 mins) IST
  // 09:15 is the first candle start time, 15:29 is the last 1m candle start time (ends at 15:30)
  return totalMins >= 555 && totalMins < 930;
}

export function getLastMarketCloseTime(): number {
  let ts = Date.now();
  if (isMarketHours(ts)) return ts;
  
  ts = Math.floor(ts / 60000) * 60000;
  while (!isMarketHours(ts)) {
    ts -= 10 * 60000;
  }
  while (isMarketHours(ts + 60000)) {
    ts += 60000;
  }
  return ts + 60000;
}

export async function purgeOutOfMarketData(): Promise<void> {
  try {
    const qNifty = `
      DELETE FROM candles 
      WHERE instrument = 'NIFTY' AND (
        EXTRACT(DOW FROM (timestamp + INTERVAL '5 hours 30 minutes')) IN (0, 6)
        OR (EXTRACT(HOUR FROM (timestamp + INTERVAL '5 hours 30 minutes')) * 60 + EXTRACT(MINUTE FROM (timestamp + INTERVAL '5 hours 30 minutes'))) < 555
        OR (EXTRACT(HOUR FROM (timestamp + INTERVAL '5 hours 30 minutes')) * 60 + EXTRACT(MINUTE FROM (timestamp + INTERVAL '5 hours 30 minutes'))) >= 930
      )
    `;
    const qPurgeOld = `DELETE FROM candles WHERE UPPER(instrument) != 'NIFTY'`;
    const qNiftyTicks = `
      DELETE FROM ticks 
      WHERE instrument = 'NIFTY' AND (
        EXTRACT(DOW FROM (timestamp + INTERVAL '5 hours 30 minutes')) IN (0, 6)
        OR (EXTRACT(HOUR FROM (timestamp + INTERVAL '5 hours 30 minutes')) * 60 + EXTRACT(MINUTE FROM (timestamp + INTERVAL '5 hours 30 minutes'))) < 555
        OR (EXTRACT(HOUR FROM (timestamp + INTERVAL '5 hours 30 minutes')) * 60 + EXTRACT(MINUTE FROM (timestamp + INTERVAL '5 hours 30 minutes'))) >= 930
      )
    `;
    const qPurgeOldTicks = `DELETE FROM ticks WHERE UPPER(instrument) != 'NIFTY'`;
    // Purge completely flat NSE exchange holiday days (e.g. Guru Nanak Jayanti) where
    // polling recorded identical OHLC across >= 30 bars, which corrupts PDH/PDL and ATR/ADX.
    const qPurgeFlatHolidayCandles = `
      DELETE FROM candles c
      USING (
        SELECT instrument, timeframe,
               DATE(timestamp + INTERVAL '5 hours 30 minutes') AS ist_day
        FROM candles
        WHERE instrument = 'NIFTY'
        GROUP BY instrument, timeframe, DATE(timestamp + INTERVAL '5 hours 30 minutes')
        HAVING COUNT(*) >= 30 AND (MAX(high) - MIN(low)) < 0.5
      ) flat
      WHERE c.instrument = flat.instrument
        AND c.timeframe = flat.timeframe
        AND DATE(c.timestamp + INTERVAL '5 hours 30 minutes') = flat.ist_day
    `;
    const pool = createPool();
    if (pool) {
      await pool.query(qNifty);
      await pool.query(qPurgeOld);
      await pool.query(qNiftyTicks);
      await pool.query(qPurgeOldTicks);
      await pool.query(qPurgeFlatHolidayCandles);
    }
  } catch (e: any) {
    console.warn("Notice: purgeOutOfMarketData warning:", e.message);
  }
}

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

  // Strictly reject ticks outside market trading hours or during weekends
  if (!isMarketHours(timestamp)) {
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
  // Never build candles outside trading hours
  if (!isMarketHours(currentTimestamp)) {
    return;
  }

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

      const existingVol = existing[0]?.volume || 0;
      const vol = existingVol > 0 ? existingVol : 1;

      if (existing.length > 0) {
        // Update candle
        await db.update(candles).set({
          open, high, low, close, volume: vol
        }).where(eq(candles.id, existing[0].id));
      } else {
        // Insert candle
        await db.insert(candles).values({
          instrument,
          timeframe: tf,
          open, high, low, close, volume: vol,
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
    const rows = await db.select().from(candles).where(
      and(
        eq(candles.instrument, instrument),
        eq(candles.timeframe, timeframe)
      )
    ).orderBy(desc(candles.timestamp)).limit(limit * 3);

    // Strictly filter out any candles outside market hours or on weekends
    const valid = rows.filter(r => isMarketHours(r.timestamp));
    return valid.slice(0, limit);
  } catch (e) {
    console.error("Failed to get candles:", e);
    return [];
  }
}

export async function seedHistoricalCandles(instrument: string, timeframe: number, candleData: Array<[string, number, number, number, number, number, number]>) {
  try {
    // Strictly filter for market hours
    const validData = candleData.filter(c => isMarketHours(c[0]));

    const rawCandles = validData.map(c => {
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
    const aggregated = new Map<string, any>();
    
    for (const c of rawCandles) {
       const ts = c.timestamp.getTime();
       const bucketStartMs = Math.floor(ts / tfMs) * tfMs;
       if (!isMarketHours(bucketStartMs)) continue;

       // Group key by date and bucket to never aggregate across days
       const istDateStr = new Date(ts + 19800000).toISOString().split('T')[0];
       const key = `${istDateStr}_${bucketStartMs}`;

       if (!aggregated.has(key)) {
         aggregated.set(key, {
           instrument, timeframe,
           timestamp: new Date(bucketStartMs),
           open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
         });
       } else {
         const existing = aggregated.get(key);
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

let isSeedingNifty = false;
let cachedNiftyFutKey: string | null = null;
let cachedNiftyFutTime = 0;

export async function getActiveNiftyFutureKey(): Promise<string> {
  if (cachedNiftyFutKey && Date.now() - cachedNiftyFutTime < 6 * 3600000) {
    return cachedNiftyFutKey;
  }
  try {
    const res = await axios.get('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    const zlib = await import('zlib');
    const buf = await new Promise<Buffer>((resolve, reject) => {
      zlib.gunzip(res.data, (err, b) => err ? reject(err) : resolve(b));
    });
    const data = JSON.parse(buf.toString('utf-8'));
    const now = Date.now();
    const niftyFuts = data.filter((d: any) => 
      d.name === 'NIFTY' && 
      d.instrument_type === 'FUT' && 
      d.expiry > now
    ).sort((a: any, b: any) => a.expiry - b.expiry);
    if (niftyFuts.length > 0) {
      cachedNiftyFutKey = niftyFuts[0].instrument_key;
      cachedNiftyFutTime = Date.now();
      return cachedNiftyFutKey;
    }
  } catch (e: any) {
    console.warn("[DB] Failed to resolve active Nifty FUT contract key:", e.message);
  }
  return 'NSE_FO|61471'; // Active November contract fallback
}

export async function ensureNiftyCandles(forceToken?: string): Promise<void> {
  if (isSeedingNifty) return;
  try {
    isSeedingNifty = true;
    const existing = await db.select().from(candles).where(
      and(
        eq(candles.instrument, 'NIFTY'),
        eq(candles.timeframe, 1)
      )
    ).orderBy(desc(candles.timestamp)).limit(20);

    const nowMs = Date.now();
    const isNseOpen = isMarketHours(new Date());
    const lastMarketCloseMs = getLastMarketCloseTime();
    const latestTimestamp = existing[0] ? new Date(existing[0].timestamp).getTime() : 0;

    const hasOutdatedData = existing.length < 20 || (
      existing.some(c => !isMarketHours(c.timestamp)) ||
      (isNseOpen && (nowMs - latestTimestamp > 5 * 60000)) ||
      (!isNseOpen && (lastMarketCloseMs - latestTimestamp > 30 * 60000)) ||
      existing.every(c => !c.volume || c.volume === 0)
    );

    if (!hasOutdatedData) {
      return; // Already populated with fresh real data including volume
    }

    console.log("[DB] Detected missing or stale Nifty candles. Syncing latest Upstox intraday + historical data...");

    const token = forceToken || process.env.UPSTOX_ACCESS_TOKEN;
    if (!token) return;

    const today = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    // 1. Fetch both intraday (today) and multi-day historical spot candles
    let intraCandles: any[] = [];
    try {
      const sIntra = await axios.get(
        'https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/1',
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: 6000 }
      );
      if (sIntra.data?.status === 'success' && sIntra.data.data?.candles?.length > 0) {
        intraCandles = sIntra.data.data.candles;
      }
    } catch (_) {}

    let histCandles: any[] = [];
    try {
      const sHist = await axios.get(
        `https://api.upstox.com/v2/historical-candle/NSE_INDEX%7CNifty%2050/1minute/${today}/${startDate}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: 7000 }
      );
      histCandles = sHist.data?.data?.candles || [];
    } catch (_) {}

    const spotMap = new Map<string, any>();
    histCandles.forEach((c: any) => spotMap.set(c[0], c));
    intraCandles.forEach((c: any) => spotMap.set(c[0], c));
    const spotCandles = Array.from(spotMap.values());

    if (spotCandles.length === 0) return;

    // 2. Fetch active Nifty Future candles (intraday + historical) to extract real market volume
    const futKey = await getActiveNiftyFutureKey();
    const encodedFutKey = encodeURIComponent(futKey.replace(':', '|'));
    let fIntraCandles: any[] = [];
    try {
      const fIntra = await axios.get(
        `https://api.upstox.com/v3/historical-candle/intraday/${encodedFutKey}/minutes/1`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: 6000 }
      );
      if (fIntra.data?.status === 'success' && fIntra.data.data?.candles?.length > 0) {
        fIntraCandles = fIntra.data.data.candles;
      }
    } catch (_) {}

    let fHistCandles: any[] = [];
    try {
      const fHist = await axios.get(
        `https://api.upstox.com/v2/historical-candle/${encodedFutKey}/1minute/${today}/${startDate}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: 7000 }
      );
      fHistCandles = fHist.data?.data?.candles || [];
    } catch (_) {}

    const volMap = new Map<number, number>();
    fHistCandles.forEach((fc: any) => {
      const tMs = Math.floor(new Date(fc[0]).getTime() / 60000) * 60000;
      volMap.set(tMs, Number(fc[5]) || 0);
    });
    fIntraCandles.forEach((fc: any) => {
      const tMs = Math.floor(new Date(fc[0]).getTime() / 60000) * 60000;
      volMap.set(tMs, Number(fc[5]) || 0);
    });

    // 3. Merge genuine Upstox volume with Nifty spot candles
    const mergedCandles = spotCandles.map((sc: any): [string, number, number, number, number, number, number] => {
      const tMs = Math.floor(new Date(sc[0]).getTime() / 60000) * 60000;
      const vol = volMap.get(tMs) || Number(sc[5]) || 1;
      return [String(sc[0]), Number(sc[1]), Number(sc[2]), Number(sc[3]), Number(sc[4]), Number(vol), Number(sc[6] || 0)];
    });

    console.log(`[DB] Seeding ${mergedCandles.length} Upstox Nifty candles with real trading volume...`);
    await seedHistoricalCandles('NIFTY', 1, mergedCandles);
  } catch (err: any) {
    console.error("[DB] Error seeding Nifty candles with volume:", err.message);
  } finally {
    isSeedingNifty = false;
  }
}

let isSeedingNifty5m = false;

export async function ensureNifty5mCandles(forceToken?: string): Promise<void> {
  if (isSeedingNifty5m) return;
  try {
    isSeedingNifty5m = true;
    const existing = await db.select().from(candles).where(
      and(
        eq(candles.instrument, 'NIFTY'),
        eq(candles.timeframe, 5)
      )
    ).orderBy(desc(candles.timestamp)).limit(20);

    const nowMs = Date.now();
    const isNseOpen = isMarketHours(new Date());
    const lastMarketCloseMs = getLastMarketCloseTime();
    const latestTimestamp = existing[0] ? new Date(existing[0].timestamp).getTime() : 0;

    const hasOutdated = existing.length < 20 || (
      existing.some(c => !isMarketHours(c.timestamp)) ||
      (isNseOpen && (nowMs - latestTimestamp > 15 * 60000)) ||
      (!isNseOpen && (lastMarketCloseMs - latestTimestamp > 30 * 60000))
    );

    if (!hasOutdated) return;

    const token = forceToken || process.env.UPSTOX_ACCESS_TOKEN;
    if (!token) return;

    const today = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    let intraCandles: any[] = [];
    try {
      const sIntra = await axios.get(
        'https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/5',
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: 6000 }
      );
      if (sIntra.data?.status === 'success' && sIntra.data.data?.candles?.length > 0) {
        intraCandles = sIntra.data.data.candles;
      }
    } catch (_) {}

    let histCandles: any[] = [];
    try {
      const sHist = await axios.get(
        `https://api.upstox.com/v2/historical-candle/NSE_INDEX%7CNifty%2050/5minute/${today}/${startDate}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: 7000 }
      );
      histCandles = sHist.data?.data?.candles || [];
    } catch (_) {}

    const spotMap = new Map<string, any>();
    histCandles.forEach((c: any) => spotMap.set(c[0], c));
    intraCandles.forEach((c: any) => spotMap.set(c[0], c));
    const spotCandles = Array.from(spotMap.values());

    if (spotCandles.length > 0) {
      const futKey = await getActiveNiftyFutureKey();
      const encodedFutKey = encodeURIComponent(futKey.replace(':', '|'));
      let futCandles: any[] = [];
      try {
        const fIntra = await axios.get(
          `https://api.upstox.com/v3/historical-candle/intraday/${encodedFutKey}/minutes/5`,
          { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: 6000 }
        );
        if (fIntra.data?.status === 'success' && fIntra.data.data?.candles?.length > 0) {
          futCandles = fIntra.data.data.candles;
        }
      } catch (_) {}

      const volMap = new Map<number, number>();
      for (const fc of futCandles) {
        const tMs = Math.floor(new Date(fc[0]).getTime() / (5 * 60000)) * (5 * 60000);
        volMap.set(tMs, Number(fc[5]) || 0);
      }

      const mergedCandles = spotCandles.map((sc: any): [string, number, number, number, number, number, number] => {
        const tMs = Math.floor(new Date(sc[0]).getTime() / (5 * 60000)) * (5 * 60000);
        const vol = volMap.get(tMs) || Number(sc[5]) || 1;
        return [String(sc[0]), Number(sc[1]), Number(sc[2]), Number(sc[3]), Number(sc[4]), Number(vol), Number(sc[6] || 0)];
      });

      console.log(`[DB] Seeding ${mergedCandles.length} Upstox 5-min Nifty candles with volume...`);
      await seedHistoricalCandles('NIFTY', 5, mergedCandles);
      return;
    }

    // Fallback: Aggregate 1m candles into 5m candles in DB
    const oneMinCandles = await db.select().from(candles).where(
      and(
        eq(candles.instrument, 'NIFTY'),
        eq(candles.timeframe, 1)
      )
    ).orderBy(asc(candles.timestamp));

    if (oneMinCandles.length >= 5) {
      const fiveMinCandles: Array<[string, number, number, number, number, number, number]> = [];
      let curPeriodMs = 0;
      let curOpen = 0;
      let curHigh = 0;
      let curLow = 0;
      let curClose = 0;
      let curVol = 0;
      const periodMs = 5 * 60 * 1000;

      for (const c of oneMinCandles) {
        const ts = new Date(c.timestamp).getTime();
        const boundary = Math.floor((ts + 19800000) / periodMs) * periodMs - 19800000;

        if (boundary !== curPeriodMs) {
          if (curPeriodMs !== 0) {
            fiveMinCandles.push([new Date(curPeriodMs).toISOString(), curOpen, curHigh, curLow, curClose, curVol, 0]);
          }
          curPeriodMs = boundary;
          curOpen = c.open;
          curHigh = c.high;
          curLow = c.low;
          curClose = c.close;
          curVol = c.volume;
        } else {
          curHigh = Math.max(curHigh, c.high);
          curLow = Math.min(curLow, c.low);
          curClose = c.close;
          curVol += c.volume;
        }
      }
      if (curPeriodMs !== 0) {
        fiveMinCandles.push([new Date(curPeriodMs).toISOString(), curOpen, curHigh, curLow, curClose, curVol, 0]);
      }

      if (fiveMinCandles.length > 0) {
        await seedHistoricalCandles('NIFTY', 5, fiveMinCandles);
      }
    }
  } catch (err: any) {
    console.error("[DB] Error ensuring Nifty 5m candles:", err.message);
  } finally {
    isSeedingNifty5m = false;
  }
}

