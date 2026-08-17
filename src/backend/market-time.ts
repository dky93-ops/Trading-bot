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
