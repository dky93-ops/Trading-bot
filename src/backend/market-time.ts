export interface SpotTick {
  timestamp: number;
  price: number;
  volume?: number;
}

export interface OneMinuteCandle {
  timestamp: number;
  closeTimestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  completed: boolean;
}

export function buildOneMinuteCandle(
  ticks: SpotTick[],
  candleStart: number,
  nowMs: number,
): OneMinuteCandle | undefined {
  const end = candleStart + 60_000;
  const inside = ticks
    .filter(t => t.timestamp >= candleStart && t.timestamp < end)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!inside.length || nowMs < end) return undefined;
  const prices = inside.map(t => t.price).filter(Number.isFinite);
  if (!prices.length || prices.some(p => p <= 0)) return undefined;

  return {
    timestamp: candleStart,
    closeTimestamp: end,
    open: prices[0],
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices[prices.length - 1],
    volume: inside.reduce((sum, t) => sum + (Number(t.volume) || 0), 0),
    completed: true,
  };
}

export function filterCompletedOneMinuteCandles(
  candles: OneMinuteCandle[],
  nowMs: number,
): OneMinuteCandle[] {
  return candles
    .filter(c => c.completed && c.closeTimestamp <= nowMs)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Checks whether a timestamp falls strictly within genuine market trading hours.
 * - NSE (NIFTY/BANKNIFTY/SENSEX): Mon-Fri 09:15 to 15:30 IST (first candle starts 09:15, last ends 15:30).
 * Weekends (Saturday and Sunday) and non-market hours are strictly excluded.
 */
export function isMarketHours(timestamp: Date | number | string): boolean {
  const d = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (!d || isNaN(d.getTime())) return false;

  // Shift UTC to IST (+5 hours 30 minutes = +19800000 ms)
  const istDate = new Date(d.getTime() + 19800000);
  const day = istDate.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false;

  const totalMins = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  // NSE Trading Hours: 09:15 AM (555 mins) to 03:30 PM (930 mins) IST
  // 09:15 is the first candle start time, 15:29 is the last 1m candle start time (ends at 15:30)
  return totalMins >= 555 && totalMins < 930;
}

