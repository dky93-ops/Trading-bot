import { describe, it, expect } from 'vitest';
import { isMarketHours } from '../src/backend/market-time';
import { getLastMarketCloseTime } from '../src/db/market';

describe('Market Hours & Chart Continuity Rules', () => {
  it('strictly validates NSE trading hours (09:15 - 15:30 IST, Monday-Friday)', () => {
    // 2026-10-16 is Friday
    // 09:15 IST = 03:45 UTC
    const fri915IST = new Date('2026-10-16T03:45:00.000Z');
    expect(isMarketHours(fri915IST, false)).toBe(true);

    // 15:25 IST = 09:55 UTC (5m final candle)
    const fri1525IST = new Date('2026-10-16T09:55:00.000Z');
    expect(isMarketHours(fri1525IST, false)).toBe(true);

    // 15:29 IST = 09:59 UTC (1m final candle)
    const fri1529IST = new Date('2026-10-16T09:59:00.000Z');
    expect(isMarketHours(fri1529IST, false)).toBe(true);

    // 15:30 IST = 10:00 UTC (Market closed - no new candle starts at 15:30)
    const fri1530IST = new Date('2026-10-16T10:00:00.000Z');
    expect(isMarketHours(fri1530IST, false)).toBe(false);

    // 16:00 IST = 10:30 UTC (After market hours)
    const fri1600IST = new Date('2026-10-16T10:30:00.000Z');
    expect(isMarketHours(fri1600IST, false)).toBe(false);

    // 09:14 IST = 03:44 UTC (Pre-market - strictly rejected)
    const fri914IST = new Date('2026-10-16T03:44:00.000Z');
    expect(isMarketHours(fri914IST, false)).toBe(false);

    // 2026-10-17 is Saturday (Weekend - strictly rejected)
    const sat1000IST = new Date('2026-10-17T04:30:00.000Z');
    expect(isMarketHours(sat1000IST, false)).toBe(false);

    // 2026-10-18 is Sunday (Weekend - strictly rejected)
    const sun1000IST = new Date('2026-10-18T04:30:00.000Z');
    expect(isMarketHours(sun1000IST, false)).toBe(false);

    // 2026-10-19 is Monday 09:15 IST (Next market session open)
    const mon915IST = new Date('2026-10-19T03:45:00.000Z');
    expect(isMarketHours(mon915IST, false)).toBe(true);
  });

  it('strictly validates MCX Gold trading hours (09:00 - 23:30 IST, Monday-Friday)', () => {
    // 2026-10-16 is Friday
    // 09:00 IST = 03:30 UTC
    const fri900IST = new Date('2026-10-16T03:30:00.000Z');
    expect(isMarketHours(fri900IST, true)).toBe(true);

    // 23:25 IST = 17:55 UTC (5m final candle)
    const fri2325IST = new Date('2026-10-16T17:55:00.000Z');
    expect(isMarketHours(fri2325IST, true)).toBe(true);

    // 23:29 IST = 17:59 UTC (1m final candle)
    const fri2329IST = new Date('2026-10-16T17:59:00.000Z');
    expect(isMarketHours(fri2329IST, true)).toBe(true);

    // 23:30 IST = 18:00 UTC (Market closed)
    const fri2330IST = new Date('2026-10-16T18:00:00.000Z');
    expect(isMarketHours(fri2330IST, true)).toBe(false);

    // 08:59 IST = 03:29 UTC (Pre-market)
    const fri859IST = new Date('2026-10-16T03:29:00.000Z');
    expect(isMarketHours(fri859IST, true)).toBe(false);

    // Weekend (Saturday/Sunday) strictly rejected
    const satGold = new Date('2026-10-17T10:00:00.000Z');
    expect(isMarketHours(satGold, true)).toBe(false);
  });

  it('calculates the exact previous market session close timestamp when market is closed', () => {
    const lastNiftyClose = getLastMarketCloseTime(false);
    const dNifty = new Date(lastNiftyClose);
    const istNifty = new Date(dNifty.getTime() + 19800000);
    expect(istNifty.getUTCHours()).toBe(15);
    expect(istNifty.getUTCMinutes()).toBe(30);

    const lastGoldClose = getLastMarketCloseTime(true);
    const dGold = new Date(lastGoldClose);
    const istGold = new Date(dGold.getTime() + 19800000);
    expect(istGold.getUTCHours()).toBe(23);
    expect(istGold.getUTCMinutes()).toBe(30);
  });

  it('guarantees seamless chart continuation from Friday close directly to Monday open with no intervening periods', () => {
    const rawCandles = [
      { timestamp: '2026-10-16T09:50:00.000Z', close: 23120 }, // Fri 15:20 IST
      { timestamp: '2026-10-16T09:55:00.000Z', close: 23140 }, // Fri 15:25 IST
      { timestamp: '2026-10-16T10:30:00.000Z', close: 23145 }, // Fri 16:00 IST (INVALID - post-market)
      { timestamp: '2026-10-17T06:00:00.000Z', close: 23150 }, // Sat 11:30 IST (INVALID - weekend)
      { timestamp: '2026-10-18T10:40:00.000Z', close: 23155 }, // Sun 16:10 IST (INVALID - weekend)
      { timestamp: '2026-10-19T03:45:00.000Z', close: 23200 }, // Mon 09:15 IST (VALID - next market open)
      { timestamp: '2026-10-19T03:50:00.000Z', close: 23220 }, // Mon 09:20 IST (VALID)
    ];

    const filtered = rawCandles.filter(c => isMarketHours(c.timestamp, false));
    expect(filtered.length).toBe(4);
    expect(filtered.map(c => c.close)).toEqual([23120, 23140, 23200, 23220]);
    // The sequence goes directly from Fri 15:25 IST (23140) to Mon 09:15 IST (23200)
  });
});
