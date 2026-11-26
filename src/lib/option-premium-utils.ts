export const NIFTY_LOT_SIZE = 65;
export const IST_OFFSET_SEC = 19800;
export const IST_OFFSET_MS = IST_OFFSET_SEC * 1000;

export type OptionDataSource =
  | 'OPTION_CHAIN_HISTORY'
  | 'UPSTOX_OPTION_CANDLE'
  | 'UNAVAILABLE';

export interface CompactStrikeQuote {
  ce?: number;
  pe?: number;
  ceD?: number;
  peD?: number;
}

export interface CompactOptionSnapshot {
  t: number; // UTC ms
  spot: number;
  atm: number;
  expiry?: string;
  ceLtp: number | null;
  peLtp: number | null;
  ceDelta: number | null;
  peDelta: number | null;
  strikes?: Record<number, CompactStrikeQuote>;
}

export interface TradeOptionInput {
  id: string;
  type: 'LONG' | 'SHORT';
  entryTime: number; // UTC epoch seconds shifted by +19800 (LiveChart candle time convention)
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
  exitReason?: string;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'BE';
  pnl?: number;
  timeframeMin?: number;
  entrySpotBar?: { open: number; high: number; low: number; close: number };
  exitSpotBar?: { open: number; high: number; low: number; close: number };
}

export interface ResolvedTradeOptionData {
  optionStrike: number;
  optionType: 'CE' | 'PE';
  optionExpiry?: string;
  optionDelta?: number;
  optionEntryPremium?: number;
  optionExitPremium?: number;
  premiumPnl?: number;
  lotPnl?: number;
  optionDataSource: OptionDataSource;
}

export interface OptionCandleBar {
  t: number; // UTC ms (start of 1-min candle)
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  oi?: number;
}

export function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export function toIstDateKey(utcMs: number): string {
  return new Date(utcMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function clampNumber(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function round2(val: number): number {
  return Number(val.toFixed(2));
}

function getStrikePriceAndDelta(
  snap: CompactOptionSnapshot,
  strike: number,
  optType: 'CE' | 'PE'
): { ltp?: number; delta?: number } {
  const fromMap = snap.strikes?.[strike];
  if (fromMap) {
    const ltp = optType === 'CE' ? fromMap.ce : fromMap.pe;
    const rawDelta = optType === 'CE' ? fromMap.ceD : fromMap.peD;
    if (isPositiveFinite(ltp)) {
      return {
        ltp,
        delta: typeof rawDelta === 'number' && Number.isFinite(rawDelta) ? Math.abs(rawDelta) : undefined,
      };
    }
  }

  // Backward-compatible lookup only when the snapshot is strictly for the same ATM strike
  if (snap.atm === strike) {
    const ltp = optType === 'CE' ? snap.ceLtp : snap.peLtp;
    const rawDelta = optType === 'CE' ? snap.ceDelta : snap.peDelta;
    if (isPositiveFinite(ltp)) {
      return {
        ltp,
        delta: typeof rawDelta === 'number' && Number.isFinite(rawDelta) ? Math.abs(rawDelta) : undefined,
      };
    }
  }

  return {};
}

function findNearestSnapshotForStrike(
  snapshots: CompactOptionSnapshot[],
  targetUtcMs: number,
  istDateKey: string,
  strike: number,
  optType: 'CE' | 'PE',
  maxDiffMs: number,
  expectedExpiry?: string
): { snap: CompactOptionSnapshot; ltp: number; delta?: number; diffMs: number } | null {
  let best: { snap: CompactOptionSnapshot; ltp: number; delta?: number; diffMs: number } | null = null;

  for (const snap of snapshots) {
    if (toIstDateKey(snap.t) !== istDateKey) continue;
    if (expectedExpiry && snap.expiry && snap.expiry !== expectedExpiry) continue;

    const diffMs = Math.abs(snap.t - targetUtcMs);
    if (diffMs > maxDiffMs) continue;

    const { ltp, delta } = getStrikePriceAndDelta(snap, strike, optType);
    if (!isPositiveFinite(ltp)) continue;

    if (!best || diffMs < best.diffMs) {
      best = { snap, ltp, delta, diffMs };
    }
  }

  return best;
}

/**
 * Resolves exact entry and exit option premiums from recorded option chain history snapshots.
 * Looks up the EXACT traded strike at both entry and exit timestamps (real exitLtp - entryLtp).
 * Never fabricates synthetic ₹100 / 0.50-delta premiums when real history is absent.
 */
export function resolveTradeFromSnapshots(
  trade: TradeOptionInput,
  snapshots: CompactOptionSnapshot[] = [],
  lotSize: number = NIFTY_LOT_SIZE
): ResolvedTradeOptionData {
  const optType: 'CE' | 'PE' = trade.type === 'LONG' ? 'CE' : 'PE';
  const strike = Math.round(trade.entryPrice / 50) * 50;

  if (!snapshots || snapshots.length === 0 || !trade.entryTime) {
    return {
      optionStrike: strike,
      optionType: optType,
      optionDataSource: 'UNAVAILABLE',
    };
  }

  const tfMin = Math.max(1, Number(trade.timeframeMin) || 1);
  const entryCandleOpenUtcMs = (trade.entryTime - IST_OFFSET_SEC) * 1000;
  // Bar-close entries fill at candle close (open + tfMin minutes)
  const entryTargetUtcMs = entryCandleOpenUtcMs + tfMin * 60_000;
  const entryDateKey = toIstDateKey(entryCandleOpenUtcMs);
  const maxSnapDiffMs = Math.max(3, tfMin + 2) * 60_000;

  const entryMatch = findNearestSnapshotForStrike(
    snapshots,
    entryTargetUtcMs,
    entryDateKey,
    strike,
    optType,
    maxSnapDiffMs
  );

  if (!entryMatch) {
    return {
      optionStrike: strike,
      optionType: optType,
      optionDataSource: 'UNAVAILABLE',
    };
  }

  const entryPremium = round2(entryMatch.ltp);
  const optionExpiry = entryMatch.snap.expiry;

  let exitMatch: { snap: CompactOptionSnapshot; ltp: number; delta?: number; diffMs: number } | null = null;

  if (trade.status !== 'OPEN' && trade.exitTime) {
    const exitCandleOpenUtcMs = (trade.exitTime - IST_OFFSET_SEC) * 1000;
    const isIntraBarExit =
      trade.exitReason === 'TARGET' ||
      trade.exitReason === 'STOPLOSS' ||
      trade.exitReason === 'BREAKEVEN';
    const exitTargetUtcMs = isIntraBarExit
      ? exitCandleOpenUtcMs + Math.floor((tfMin * 60_000) / 2)
      : exitCandleOpenUtcMs + tfMin * 60_000;
    const exitDateKey = toIstDateKey(exitCandleOpenUtcMs);

    exitMatch = findNearestSnapshotForStrike(
      snapshots,
      exitTargetUtcMs,
      exitDateKey,
      strike,
      optType,
      maxSnapDiffMs,
      optionExpiry
    );
  } else if (trade.status === 'OPEN') {
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const snap = snapshots[i];
      if (snap.t < entryMatch.snap.t) break;
      if (toIstDateKey(snap.t) !== entryDateKey) continue;
      if (optionExpiry && snap.expiry && snap.expiry !== optionExpiry) continue;
      const { ltp, delta } = getStrikePriceAndDelta(snap, strike, optType);
      if (isPositiveFinite(ltp)) {
        exitMatch = { snap, ltp, delta, diffMs: 0 };
        break;
      }
    }
  }

  if (!exitMatch) {
    return {
      optionStrike: strike,
      optionType: optType,
      optionExpiry,
      optionDelta: entryMatch.delta !== undefined ? round2(entryMatch.delta) : undefined,
      optionEntryPremium: entryPremium,
      optionDataSource: 'UNAVAILABLE',
    };
  }

  const exitPremium = round2(exitMatch.ltp);
  const premiumPnl = round2(exitPremium - entryPremium);
  const lotPnl = round2(premiumPnl * lotSize);

  return {
    optionStrike: strike,
    optionType: optType,
    optionExpiry,
    optionDelta: entryMatch.delta !== undefined ? round2(entryMatch.delta) : undefined,
    optionEntryPremium: entryPremium,
    optionExitPremium: exitPremium,
    premiumPnl,
    lotPnl,
    optionDataSource: 'OPTION_CHAIN_HISTORY',
  };
}

/**
 * Resolves option entry/exit prices from real 1-minute Upstox option OHLC candles.
 */
export function resolveTradeFromOptionCandles(
  trade: TradeOptionInput,
  candles: OptionCandleBar[],
  meta: { expiry: string; strike: number; optType: 'CE' | 'PE'; greekDelta?: number },
  lotSize: number = NIFTY_LOT_SIZE
): ResolvedTradeOptionData | null {
  if (!candles || candles.length === 0 || !trade.entryTime) return null;

  const tfMin = Math.max(1, Number(trade.timeframeMin) || 1);
  const entryCandleOpenUtcMs = (trade.entryTime - IST_OFFSET_SEC) * 1000;
  const entryDateKey = toIstDateKey(entryCandleOpenUtcMs);
  const entryCloseBarUtcMs = entryCandleOpenUtcMs + (tfMin - 1) * 60_000;

  const byMinute = new Map<number, OptionCandleBar>();
  for (const c of candles) {
    const minuteKey = Math.floor(c.t / 60_000) * 60_000;
    byMinute.set(minuteKey, c);
  }

  const findBarNear = (targetUtcMs: number, dateKey: string, maxOffsetMins = 2): OptionCandleBar | null => {
    const baseMin = Math.floor(targetUtcMs / 60_000) * 60_000;
    const exact = byMinute.get(baseMin);
    if (exact && toIstDateKey(exact.t) === dateKey && isPositiveFinite(exact.c)) {
      return exact;
    }
    for (let offset = 1; offset <= maxOffsetMins; offset++) {
      for (const dir of [-1, 1]) {
        const candidate = byMinute.get(baseMin + dir * offset * 60_000);
        if (candidate && toIstDateKey(candidate.t) === dateKey && isPositiveFinite(candidate.c)) {
          return candidate;
        }
      }
    }
    return null;
  };

  const entryBar = findBarNear(entryCloseBarUtcMs, entryDateKey, 2);
  if (!entryBar || !isPositiveFinite(entryBar.c)) return null;
  const entryPremium = round2(entryBar.c);

  let exitPremium: number | undefined;

  if (trade.status !== 'OPEN' && trade.exitTime) {
    const exitCandleOpenUtcMs = (trade.exitTime - IST_OFFSET_SEC) * 1000;
    const exitDateKey = toIstDateKey(exitCandleOpenUtcMs);

    const spanBars: OptionCandleBar[] = [];
    for (let m = 0; m < tfMin; m++) {
      const b = byMinute.get(Math.floor((exitCandleOpenUtcMs + m * 60_000) / 60_000) * 60_000);
      if (b && toIstDateKey(b.t) === exitDateKey && isPositiveFinite(b.c)) {
        spanBars.push(b);
      }
    }

    if (spanBars.length === 0) {
      const near = findBarNear(exitCandleOpenUtcMs + (tfMin - 1) * 60_000, exitDateKey, 2);
      if (near) spanBars.push(near);
    }

    if (spanBars.length === 0) return null;

    const optHigh = Math.max(...spanBars.map(b => b.h));
    const optLow = Math.min(...spanBars.map(b => b.l));
    const optClose = spanBars[spanBars.length - 1].c;

    const isIntraBarExit =
      trade.exitReason === 'TARGET' ||
      trade.exitReason === 'STOPLOSS' ||
      trade.exitReason === 'BREAKEVEN';

    if (
      isIntraBarExit &&
      trade.exitPrice !== undefined &&
      trade.exitSpotBar &&
      Number.isFinite(trade.exitSpotBar.high) &&
      Number.isFinite(trade.exitSpotBar.low) &&
      trade.exitSpotBar.high > trade.exitSpotBar.low &&
      optHigh > optLow
    ) {
      const spotRange = trade.exitSpotBar.high - trade.exitSpotBar.low;
      const rawRatio =
        meta.optType === 'CE'
          ? (trade.exitPrice - trade.exitSpotBar.low) / spotRange
          : (trade.exitSpotBar.high - trade.exitPrice) / spotRange;
      const ratio = clampNumber(rawRatio, 0, 1);
      exitPremium = round2(optLow + ratio * (optHigh - optLow));
    } else {
      exitPremium = round2(optClose);
    }
  } else if (trade.status === 'OPEN') {
    const sameDayBars = candles.filter(c => toIstDateKey(c.t) === entryDateKey && c.t >= entryBar.t);
    const latest = sameDayBars.length > 0 ? sameDayBars[sameDayBars.length - 1] : candles[candles.length - 1];
    if (!latest || !isPositiveFinite(latest.c)) return null;
    exitPremium = round2(latest.c);
  }

  if (exitPremium === undefined) return null;

  const premiumPnl = round2(exitPremium - entryPremium);
  const lotPnl = round2(premiumPnl * lotSize);

  let optionDelta: number | undefined;
  if (typeof meta.greekDelta === 'number' && Number.isFinite(meta.greekDelta) && meta.greekDelta > 0) {
    optionDelta = round2(Math.abs(meta.greekDelta));
  } else if (trade.pnl !== undefined && Math.abs(trade.pnl) >= 5) {
    const realizedDelta = Math.abs(premiumPnl / trade.pnl);
    if (Number.isFinite(realizedDelta) && realizedDelta >= 0.05 && realizedDelta <= 1.2) {
      optionDelta = round2(realizedDelta);
    }
  }

  return {
    optionStrike: meta.strike,
    optionType: meta.optType,
    optionExpiry: meta.expiry,
    optionDelta,
    optionEntryPremium: entryPremium,
    optionExitPremium: exitPremium,
    premiumPnl,
    lotPnl,
    optionDataSource: 'UPSTOX_OPTION_CANDLE',
  };
}
