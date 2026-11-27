/**
 * BEST SAM SIGNALS Strategy Engine
 * Based on Pine Script: "BEST SAM SIGNALS" (shorttitle: 'SAM')
 *
 * Parameters:
 *  - MaFast_period (default 1)
 *  - MaValue (source, default close)
 *  - MaSlow_period (default 34)
 *  - Signal_period (default 5)
 *  - Stoploss (default 20 points from entry candle)
 *  - ADX Filter option (toggle, length, threshold, directional DI check)
 */

import { computeSMA, computeEMA, computeWMA, computeADX, computeVWAP, compute5MinEMA } from './technical-indicators';

export interface SamSignalsConfig {
  maFastPeriod: number; // default: 1
  maSlowPeriod: number; // default: 34
  signalPeriod: number; // default: 5
  source: 'close' | 'hl2' | 'hlc3' | 'ohlc4';
  stopLossPoints: number; // default: 20
  targetPoints: number; // default: 60 (3:1 R:R with runner trail)
  trailingStopEnabled: boolean; // default: true: At +20pts SL->Entry, at +40pts SL->Entry+20pts
  trailStep1Points: number; // default: 20 (moves SL to Entry)
  trailStep2Points: number; // default: 40 (moves SL to Entry + 20pts)
  trailStep2LockProfit: number; // default: 20 (locked profit at step 2)
  noTradeBefore915: boolean; // default: true: No trade before 09:15 AM IST (Pre-market session restriction)
  adxFilterEnabled: boolean; // default: false
  adxPeriod: number; // default: 14
  adxThreshold: number; // default: 20
  adxRequireDirectional: boolean; // default: true (+DI > -DI for CALL, -DI > +DI for PUT)
  visibleBuy: boolean; // default: true
  visibleSell: boolean; // default: true
  colorBuy: string; // default: '#2196F3'
  colorSell: string; // default: '#FF5252'
  oneTradeAtATime: boolean; // default: true
  autoExitOpposite: boolean; // default: true

  // 1. Adverse Rejection Wick Filter (>35% wick opposing trade)
  filterRejectionWickEnabled: boolean; // default: false
  rejectionWickMaxPercent: number; // default: 35 (For LONG: Upper wick / Range > 35%. For SHORT: Lower wick / Range > 35%)

  // 2. Immediate Adverse Close on Bar +1
  filterBar1AdverseCloseEnabled: boolean; // default: false (Next candle closes in opposite direction of signal)
  bar1ActionMode: 'filter' | 'exit'; // default: 'filter' ('filter' = invalidate/skip trade, 'exit' = immediate cut loss on Bar +1 close)
  filterBar1ConfirmationEntry?: boolean; // legacy alias

  // 3. Entry Timing Configuration (Bar + 1 Close vs Bar + 1 Open vs Bar 0 Close)
  entryTiming?: 'bar1Close' | 'bar1Open' | 'bar0Close'; // default: 'bar1Close' ('bar1Close' = Confirmed on Immediate Adverse Bar + 1 close, SL & TP decided as per this entry, zero repainting; 'bar1Open' = Bar + 1 open; 'bar0Close' = Signal candle close)

  // 4. Smart VWAP Institutional Alignment, Climax Band Protection & Early Reversal Exit
  vwapFilterEnabled: boolean; // default: true (Master ON/OFF toggle for VWAP filter)
  vwapClimaxFilterEnabled?: boolean; // default: true (Avoids entering overextended climax tops/bottoms)
  vwapMaxDistancePoints?: number; // default: 70 (Maximum allowed distance in points from VWAP for taking a trade)
  vwapOpeningBufferEnabled?: boolean; // default: true (Suppresses erratic VWAP signals in opening 10 mins < 09:25 IST)
  vwapExitOppositeEnabled?: boolean; // default: true (Unblocks opposite crossover signals to exit open trades gracefully)
  showVwapLine?: boolean; // default: true (Show cyan VWAP line on chart)

  // 5. Minimum Candle Body Filter (Kill Dojis & Low-Energy Candles)
  filterMinBodyEnabled: boolean; // default: false
  minBodyPoints: number; // default: 7 (pts on Nifty Spot)
  minBodyRatioPercent: number; // default: 45 (% of candle range)

  // 6. 5-Minute Higher Timeframe (MTF) EMA Trend Alignment
  filterMtfEmaEnabled: boolean; // default: false
  mtfEmaPeriod: number; // default: 20 (5-min EMA period)
  mtfEmaRequireSlope?: boolean; // default: false (requires slope to match trade direction)

  // 7. Day High / Day Low Trap Filter (Range Boundary Exhaustion)
  filterDayTrapEnabled: boolean; // default: false
  dayTrapBufferPoints: number; // default: 10 (points within Day High / Day Low danger band)

  // 8. Dynamic Regime Classification (Dual-Mode Adaptive VWAP)
  // Resolves the dilemma where static VWAP turns trend days into wins but kills range days (like 30 Oct).
  adaptiveRegimeEnabled?: boolean; // default: true (Automatically distinguishes Trend vs Range)
  adaptiveTrendDistancePoints?: number; // default: 20 (pts from VWAP with slope to confirm Trend Mode)
  adaptiveClimaxBandPoints?: number; // default: 50 (pts from VWAP for overextension guard)
  adaptiveAllowReversionBounce?: boolean; // default: true (Permits deep exhaustion counter-bounces at climax band)

  // 9. Directional Loss-Frequency Circuit Breaker & Anti-Whipsaw Protection
  circuitBreakerEnabled?: boolean; // default: true
  circuitBreakerConsecutiveLosses?: number; // default: 3
  circuitBreakerCooldownMinutes?: number; // default: 20
  antiWhipsawEnabled?: boolean; // default: false
  antiWhipsawMinutes?: number; // default: 10

  // 10. Volatility-Adaptive Daily Drawdown Guard
  maxDailyLossEnabled?: boolean; // default: false
  maxDailyLossPoints?: number; // default: 75

  // 11. S12 Confluence Filter (DI Spread > +5 + EMA 100/200 Alignment + RVOL >= 0.70)
  filterS12ConfluenceEnabled?: boolean; // default: false
  s12DiSpreadMin?: number; // default: 5 (+DI - -DI > 5 for CALL, -DI - +DI > 5 for PUT)
  s12EmaFastPeriod?: number; // default: 100
  s12EmaSlowPeriod?: number; // default: 200
  s12MinRvol?: number; // default: 0.70 (Bar volume >= 0.70 * 20-bar volume SMA)

  // 12. Institutional Recommendation #1: 1-Min SAM(21/5) Afternoon Breakout (12:30–14:50 IST)
  //     PDH/PDL Breakout + Causal 5m ADX(14) >= 30 & DI Spread > 5
  //     Exit modes: 'fixed40' (#3: SL 40 / BE +30 / EOD) or 'chandelier' (#5: SL 0.30% / Trail 0.40% / EOD)
  filterSam21AfternoonEnabled?: boolean; // default: false
  sam21AfternoonExitMode?: 'fixed40' | 'chandelier'; // default: 'fixed40'

  // 13. Institutional Recommendation #2: Morning + Afternoon Combined (SAM 21/5)
  //     Morning: 3m SAM(21/5) OpenDrive (09:20–10:15 IST, PDH/PDL + StrongBar + 15m Supertrend, 2x/3x 5m ATR + BE30/Step2 +50->+20)
  //     Afternoon: 1m SAM(21/5) Afternoon Breakout (12:30–14:50 IST, #3 Fixed or #5 Chandelier)
  filterSam21CombinedEnabled?: boolean; // default: false
}

export const DEFAULT_SAM_CONFIG: SamSignalsConfig = {
  maFastPeriod: 1,
  maSlowPeriod: 34,
  signalPeriod: 5,
  source: 'close',
  stopLossPoints: 20,
  targetPoints: 60,
  trailingStopEnabled: true,
  trailStep1Points: 20,
  trailStep2Points: 40,
  trailStep2LockProfit: 20,
  noTradeBefore915: true,
  adxFilterEnabled: false,
  adxPeriod: 14,
  adxThreshold: 20,
  adxRequireDirectional: true,
  filterRejectionWickEnabled: false,
  rejectionWickMaxPercent: 35,
  filterBar1AdverseCloseEnabled: true,
  bar1ActionMode: 'filter',
  filterBar1ConfirmationEntry: false,
  entryTiming: 'bar1Close',
  vwapFilterEnabled: true,
  vwapClimaxFilterEnabled: true,
  vwapMaxDistancePoints: 70,
  vwapOpeningBufferEnabled: true,
  vwapExitOppositeEnabled: true,
  showVwapLine: true,
  filterMinBodyEnabled: false,
  minBodyPoints: 7,
  minBodyRatioPercent: 45,
  filterMtfEmaEnabled: false,
  mtfEmaPeriod: 20,
  mtfEmaRequireSlope: false,
  filterDayTrapEnabled: false,
  dayTrapBufferPoints: 10,
  adaptiveRegimeEnabled: true,
  adaptiveTrendDistancePoints: 20,
  adaptiveClimaxBandPoints: 50,
  adaptiveAllowReversionBounce: true,
  circuitBreakerEnabled: true,
  circuitBreakerConsecutiveLosses: 3,
  circuitBreakerCooldownMinutes: 20,
  antiWhipsawEnabled: false,
  antiWhipsawMinutes: 10,
  maxDailyLossEnabled: false,
  maxDailyLossPoints: 75,
  filterS12ConfluenceEnabled: false,
  s12DiSpreadMin: 5,
  s12EmaFastPeriod: 100,
  s12EmaSlowPeriod: 200,
  s12MinRvol: 0.7,
  filterSam21AfternoonEnabled: false,
  sam21AfternoonExitMode: 'fixed40',
  filterSam21CombinedEnabled: false,
  visibleBuy: true,
  visibleSell: true,
  colorBuy: '#2196f3',
  colorSell: '#ff5252',
  oneTradeAtATime: true,
  autoExitOpposite: true,
};

export interface SamSignalsResult {
  smaFast: number[];
  smaSlow: number[];
  buffer1: number[];
  buffer2: number[];
  callSignals: boolean[];
  putSignals: boolean[];
  candidateCallSignals?: boolean[];
  candidatePutSignals?: boolean[];
  baseCallSignals?: boolean[];
  basePutSignals?: boolean[];
  adxValues?: number[];
  plusDI?: number[];
  minusDI?: number[];
  vwapValues?: number[];
  rawCallSignals?: boolean[];
  rawPutSignals?: boolean[];
  wickFilteredCount?: number;
  bar1FilteredCount?: number;
  vwapFilteredCount?: number;
  climaxFilteredCount?: number;
  minBodyFilteredCount?: number;
  mtfEmaFilteredCount?: number;
  dayTrapFilteredCount?: number;
  adaptiveFilteredCount?: number;
  circuitBreakerFilteredCount?: number;
  antiWhipsawFilteredCount?: number;
  s12FilteredCount?: number;
  sam21AfternoonSignalCount?: number;
  sam21OpenDriveSignalCount?: number;
  samSignalProfile?: Array<'STANDARD' | 'SAM21_AFT_FIXED' | 'SAM21_AFT_CHAND' | 'SAM21_3M_OPENDRIVE'>;
  sam21LiveStatus?: {
    latestDate: string;
    latestTimeIst: string;
    latestClose: number;
    pdh: number | null;
    pdl: number | null;
    adx5m: number | null;
    diSpread5m: number | null;
    st15mDir: number;
    inputBarMinutes: number;
    breakoutState: 'ABOVE_PDH' | 'BELOW_PDL' | 'INSIDE_RANGE' | 'NO_PDH_PDL';
  };
  atr5mValues?: number[];
  regimeState?: ('TREND_BULL' | 'TREND_BEAR' | 'RANGE')[];
  mtfEmaValues?: number[];
  mtfEmaSlopes?: number[];
  ema100Values?: number[];
  ema200Values?: number[];
  currentDayHighs?: number[];
  currentDayLows?: number[];
  vwapFilterDetails?: Array<{
    barIdx: number;
    time?: any;
    direction: 'CALL' | 'PUT';
    price: number;
    vwap: number;
    stage: 'SETUP_BAR' | 'CONFIRMATION_BAR';
    distance: number;
  }>;
}

// --- Strictly Causal Helpers for Institutional SAM(21/5) Filters ---

function getIstDayAndMinute(c: { time?: any; timestamp?: any }): { dayKey: number; mins: number } | null {
  if (typeof c.time === 'number' && !isNaN(c.time)) {
    const dayKey = Math.floor(c.time / 86400);
    const secInDay = ((c.time % 86400) + 86400) % 86400;
    const mins = Math.floor(secInDay / 60);
    return { dayKey, mins };
  }
  if (c.timestamp) {
    const ms = typeof c.timestamp === 'number' ? c.timestamp : Date.parse(String(c.timestamp));
    if (!isNaN(ms)) {
      const istSec = Math.floor((ms + 19800000) / 1000);
      const dayKey = Math.floor(istSec / 86400);
      const secInDay = ((istSec % 86400) + 86400) % 86400;
      const mins = Math.floor(secInDay / 60);
      return { dayKey, mins };
    }
  }
  return null;
}

interface CausalHtfBar {
  dayKey: number;
  bucket: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Detects the chart's native candle timeframe in minutes (e.g. 1, 3, 5, 15)
 * from consecutive intra-day bar spacings.
 */
function detectInputBarMinutes(barMeta: Array<{ dayKey: number; mins: number } | null>): number {
  const diffs: number[] = [];
  for (let i = 1; i < barMeta.length && diffs.length < 60; i++) {
    const prev = barMeta[i - 1];
    const curr = barMeta[i];
    if (prev && curr && prev.dayKey === curr.dayKey) {
      const d = curr.mins - prev.mins;
      if (d > 0 && d <= 60) diffs.push(d);
    }
  }
  if (diffs.length === 0) return 1;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 1;
}

/**
 * Strictly causal higher-timeframe resampler:
 * Every bar i ONLY references bars formed from 0..i (zero future lookahead).
 * Supports any input timeframe (1m, 3m, 5m, 15m) and skips flat holiday days.
 */
function resampleCausalHTF(
  candles: Array<{ open: number; high: number; low: number; close: number }>,
  barMeta: Array<{ dayKey: number; mins: number } | null>,
  tfMinutes: number,
  inputBarMinutes: number = 1,
  flatHolidayDays?: Set<number>
): { bars: CausalHtfBar[]; lastClosedBarIdx: number[]; isClosing1mBar: boolean[] } {
  const n = candles.length;
  const bars: CausalHtfBar[] = [];
  const lastClosedBarIdx = new Array<number>(n).fill(-1);
  const isClosing1mBar = new Array<boolean>(n).fill(false);

  let curBar: CausalHtfBar | null = null;
  let lastCompleted = -1;

  for (let i = 0; i < n; i++) {
    const meta = barMeta[i];
    if (!meta || (flatHolidayDays && flatHolidayDays.has(meta.dayKey))) {
      lastClosedBarIdx[i] = lastCompleted;
      continue;
    }
    const bucket = Math.floor(meta.mins / tfMinutes);
    if (!curBar || curBar.dayKey !== meta.dayKey || curBar.bucket !== bucket) {
      if (curBar) {
        lastCompleted = bars.length - 1;
      }
      curBar = {
        dayKey: meta.dayKey,
        bucket,
        open: candles[i].open,
        high: candles[i].high,
        low: candles[i].low,
        close: candles[i].close,
      };
      bars.push(curBar);
    } else {
      curBar.high = Math.max(curBar.high, candles[i].high);
      curBar.low = Math.min(curBar.low, candles[i].low);
      curBar.close = candles[i].close;
    }

    // Causally mark HTF bar complete on the final input bar of the bucket
    // (works for 1m->3m, 3m->3m, 1m->5m, 5m->5m, 3m->15m, 5m->15m, etc.)
    const completesBucket =
      inputBarMinutes >= tfMinutes ||
      (meta.mins % tfMinutes) + inputBarMinutes >= tfMinutes;
    if (completesBucket) {
      lastCompleted = bars.length - 1;
      isClosing1mBar[i] = true;
    }
    lastClosedBarIdx[i] = lastCompleted;
  }

  return { bars, lastClosedBarIdx, isClosing1mBar };
}

function computeWilderATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = closes.length;
  const atr = new Array<number>(n).fill(NaN);
  if (n <= period) return atr;
  const tr = new Array<number>(n).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  atr[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    atr[i] = prev;
  }
  return atr;
}

function computeSupertrendDirection(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 10,
  mult = 3.0
): number[] {
  const n = closes.length;
  const dir = new Array<number>(n).fill(0);
  const atr = computeWilderATR(highs, lows, closes, period);
  const finalUpper = new Array<number>(n).fill(NaN);
  const finalLower = new Array<number>(n).fill(NaN);
  let trend = 1;
  for (let i = period; i < n; i++) {
    if (isNaN(atr[i])) continue;
    const hl2 = (highs[i] + lows[i]) / 2;
    const basicUpper = hl2 + mult * atr[i];
    const basicLower = hl2 - mult * atr[i];
    if (i === period || isNaN(finalUpper[i - 1])) {
      finalUpper[i] = basicUpper;
      finalLower[i] = basicLower;
      trend = closes[i] >= hl2 ? 1 : -1;
    } else {
      finalUpper[i] = (basicUpper < finalUpper[i - 1] || closes[i - 1] > finalUpper[i - 1]) ? basicUpper : finalUpper[i - 1];
      finalLower[i] = (basicLower > finalLower[i - 1] || closes[i - 1] < finalLower[i - 1]) ? basicLower : finalLower[i - 1];
      if (trend === 1 && closes[i] < finalLower[i]) {
        trend = -1;
      } else if (trend === -1 && closes[i] > finalUpper[i]) {
        trend = 1;
      }
    }
    dir[i] = trend;
  }
  return dir;
}

export function computeSamSignals(
  candles: Array<{ open: number; high: number; low: number; close: number; volume?: number; time?: any; timestamp?: any }>,
  customConfig?: Partial<SamSignalsConfig>
): SamSignalsResult {
  const config: SamSignalsConfig = { ...DEFAULT_SAM_CONFIG, ...customConfig };
  const len = candles.length;

  const res: SamSignalsResult = {
    smaFast: new Array(len).fill(NaN),
    smaSlow: new Array(len).fill(NaN),
    buffer1: new Array(len).fill(NaN),
    buffer2: new Array(len).fill(NaN),
    callSignals: new Array(len).fill(false),
    putSignals: new Array(len).fill(false),
    candidateCallSignals: new Array(len).fill(false),
    candidatePutSignals: new Array(len).fill(false),
    baseCallSignals: new Array(len).fill(false),
    basePutSignals: new Array(len).fill(false),
    rawCallSignals: new Array(len).fill(false),
    rawPutSignals: new Array(len).fill(false),
    wickFilteredCount: 0,
    bar1FilteredCount: 0,
    vwapFilteredCount: 0,
    climaxFilteredCount: 0,
    minBodyFilteredCount: 0,
    mtfEmaFilteredCount: 0,
    dayTrapFilteredCount: 0,
    adaptiveFilteredCount: 0,
    circuitBreakerFilteredCount: 0,
    antiWhipsawFilteredCount: 0,
    s12FilteredCount: 0,
    sam21AfternoonSignalCount: 0,
    sam21OpenDriveSignalCount: 0,
    samSignalProfile: new Array(len).fill('STANDARD'),
    atr5mValues: new Array(len).fill(NaN),
    regimeState: new Array(len).fill('RANGE'),
    vwapFilterDetails: [],
  };

  // --- Institutional SAM(21/5) Modes (Recommendation #1 Afternoon & #2 Morning+Afternoon Combined) ---
  const useSam21Afternoon = Boolean(config.filterSam21AfternoonEnabled || config.filterSam21CombinedEnabled);
  const useSam21OpenDrive = Boolean(config.filterSam21CombinedEnabled);

  if (useSam21Afternoon || useSam21OpenDrive) {
    if (len < 30) {
      return res;
    }

    const closes1m = candles.map(c => c.close);
    const barMeta = candles.map(c => getIstDayAndMinute(c));
    const inputBarMinutes = detectInputBarMinutes(barMeta);

    // Detect completely flat NSE exchange holiday days (e.g., 375 flat zero-range bars)
    // so they never overwrite PDH/PDL or collapse ATR/ADX/Supertrend on the next trading day.
    const dayStats = new Map<number, { h: number; l: number; count: number }>();
    for (let i = 0; i < len; i++) {
      const meta = barMeta[i];
      if (!meta) continue;
      const cur = dayStats.get(meta.dayKey);
      if (!cur) {
        dayStats.set(meta.dayKey, { h: candles[i].high, l: candles[i].low, count: 1 });
      } else {
        if (candles[i].high > cur.h) cur.h = candles[i].high;
        if (candles[i].low < cur.l) cur.l = candles[i].low;
        cur.count++;
      }
    }
    const flatHolidayDays = new Set<number>();
    for (const [dk, st] of dayStats.entries()) {
      if (st.count >= 15 && (st.h - st.l) < 0.5) {
        flatHolidayDays.add(dk);
      }
    }

    // Keep VWAP line available if chart displays VWAP
    if (config.showVwapLine || config.vwapFilterEnabled) {
      res.vwapValues = computeVWAP(candles);
    }

    // 1. Compute strictly causal Previous Day High (PDH) & Previous Day Low (PDL)
    //    (skipping flat holiday days so PDH/PDL always reflect the real previous trading session)
    const pdhArr = new Array<number>(len).fill(NaN);
    const pdlArr = new Array<number>(len).fill(NaN);
    let curDay = -1;
    let curDayH = -Infinity;
    let curDayL = Infinity;
    let prevDayH = NaN;
    let prevDayL = NaN;

    for (let i = 0; i < len; i++) {
      const meta = barMeta[i];
      if (!meta) continue;
      if (flatHolidayDays.has(meta.dayKey)) {
        pdhArr[i] = prevDayH;
        pdlArr[i] = prevDayL;
        continue;
      }
      if (meta.dayKey !== curDay) {
        if (curDay !== -1 && (curDayH - curDayL) >= 0.5) {
          prevDayH = curDayH;
          prevDayL = curDayL;
        }
        curDay = meta.dayKey;
        curDayH = candles[i].high;
        curDayL = candles[i].low;
      } else {
        if (candles[i].high > curDayH) curDayH = candles[i].high;
        if (candles[i].low < curDayL) curDayL = candles[i].low;
      }
      pdhArr[i] = prevDayH;
      pdlArr[i] = prevDayL;
    }

    // 2. SAM(21/5) oscillator
    const smaFast21 = [...closes1m];
    const smaSlow21 = computeSMA(closes1m, 21);
    const buf1_21 = new Array<number>(len).fill(NaN);
    for (let i = 0; i < len; i++) {
      if (!isNaN(smaSlow21[i])) {
        buf1_21[i] = smaFast21[i] - smaSlow21[i];
      }
    }
    const buf2_21 = computeWMA(buf1_21, 5);
    res.smaFast = smaFast21;
    res.smaSlow = smaSlow21;
    res.buffer1 = buf1_21;
    res.buffer2 = buf2_21;

    // 3. Causal 5-Min resampling -> 5m ADX(14) & 5m ATR(14)
    const htf5m = resampleCausalHTF(candles, barMeta, 5, inputBarMinutes, flatHolidayDays);
    const highs5m = htf5m.bars.map(b => b.high);
    const lows5m = htf5m.bars.map(b => b.low);
    const closes5m = htf5m.bars.map(b => b.close);
    const adx5m = computeADX(highs5m, lows5m, closes5m, 14);
    const atr5m = computeWilderATR(highs5m, lows5m, closes5m, 14);

    // Map 5m ATR onto every bar causally
    for (let i = 0; i < len; i++) {
      const idx5 = htf5m.lastClosedBarIdx[i];
      if (idx5 >= 0 && !isNaN(atr5m[idx5])) {
        res.atr5mValues![i] = atr5m[idx5];
      }
    }

    // 4. Optional Causal 3-Min SAM(21/5) + 3m ATR(14) + Causal 15-Min Supertrend(10, 3) for Morning OpenDrive
    let htf3m: ReturnType<typeof resampleCausalHTF> | null = null;
    let buf1_3m: number[] | null = null;
    let buf2_3m: number[] | null = null;
    let atr3m: number[] | null = null;
    let htf15m: ReturnType<typeof resampleCausalHTF> | null = null;
    let st15mDir: number[] | null = null;

    if (useSam21OpenDrive) {
      htf3m = resampleCausalHTF(candles, barMeta, 3, inputBarMinutes, flatHolidayDays);
      const highs3m = htf3m.bars.map(b => b.high);
      const lows3m = htf3m.bars.map(b => b.low);
      const closes3m = htf3m.bars.map(b => b.close);
      const smaSlow3m = computeSMA(closes3m, 21);
      buf1_3m = closes3m.map((c, idx) => (isNaN(smaSlow3m[idx]) ? NaN : c - smaSlow3m[idx]));
      buf2_3m = computeWMA(buf1_3m, 5);
      atr3m = computeWilderATR(highs3m, lows3m, closes3m, 14);

      htf15m = resampleCausalHTF(candles, barMeta, 15, inputBarMinutes, flatHolidayDays);
      const highs15m = htf15m.bars.map(b => b.high);
      const lows15m = htf15m.bars.map(b => b.low);
      const closes15m = htf15m.bars.map(b => b.close);
      st15mDir = computeSupertrendDirection(highs15m, lows15m, closes15m, 10, 3.0);
    }

    const aftProfile: 'SAM21_AFT_FIXED' | 'SAM21_AFT_CHAND' =
      config.sam21AfternoonExitMode === 'chandelier' ? 'SAM21_AFT_CHAND' : 'SAM21_AFT_FIXED';

    // 5. Evaluate institutional signal triggers causally per bar
    for (let i = 1; i < len; i++) {
      const meta = barMeta[i];
      if (!meta || flatHolidayDays.has(meta.dayKey)) continue;
      const mins = meta.mins;
      const pdh = pdhArr[i];
      const pdl = pdlArr[i];
      if (isNaN(pdh) || isNaN(pdl)) continue;

      // A. Morning Window (#1): 3m SAM(21/5) OpenDrive (09:20–10:15 IST)
      if (useSam21OpenDrive && mins >= 560 && mins <= 615 && htf3m && buf1_3m && buf2_3m && atr3m && htf15m && st15mDir) {
        if (htf3m.isClosing1mBar[i]) {
          const idx3 = htf3m.lastClosedBarIdx[i];
          const idx15 = htf15m.lastClosedBarIdx[i];
          if (idx3 >= 1 && idx15 >= 0) {
            const b1c = buf1_3m[idx3];
            const b2c = buf2_3m[idx3];
            const b1p = buf1_3m[idx3 - 1];
            const b2p = buf2_3m[idx3 - 1];
            const a3 = atr3m[idx3];
            const stDir = st15mDir[idx15];
            const bar3 = htf3m.bars[idx3];

            if (!isNaN(b1c) && !isNaN(b2c) && !isNaN(b1p) && !isNaN(b2p) && !isNaN(a3) && a3 > 0 && stDir !== 0 && bar3) {
              const crossUp3m = b1c > b2c && b1p <= b2p;
              const crossDn3m = b1c < b2c && b1p >= b2p;
              const barRange = bar3.high - bar3.low;
              const barBody = Math.abs(bar3.close - bar3.open);
              const strongExpansion = barRange > 0 && (barBody / barRange) >= 0.60 && barBody >= 1.1 * a3;

              if (crossUp3m && strongExpansion && bar3.close > bar3.open && bar3.close > pdh && stDir === 1) {
                if (res.rawCallSignals) res.rawCallSignals[i] = true;
                if (config.visibleBuy !== false) {
                  res.callSignals[i] = true;
                  res.samSignalProfile![i] = 'SAM21_3M_OPENDRIVE';
                  res.sam21OpenDriveSignalCount = (res.sam21OpenDriveSignalCount || 0) + 1;
                }
              } else if (crossDn3m && strongExpansion && bar3.close < bar3.open && bar3.close < pdl && stDir === -1) {
                if (res.rawPutSignals) res.rawPutSignals[i] = true;
                if (config.visibleSell !== false) {
                  res.putSignals[i] = true;
                  res.samSignalProfile![i] = 'SAM21_3M_OPENDRIVE';
                  res.sam21OpenDriveSignalCount = (res.sam21OpenDriveSignalCount || 0) + 1;
                }
              }
            }
          }
        }
      }

      // B. Afternoon Window (#3 / #5): 1m SAM(21/5) Afternoon Breakout (12:30–14:50 IST)
      if (useSam21Afternoon && mins >= 750 && mins <= 890) {
        const b1c = buf1_21[i];
        const b2c = buf2_21[i];
        const b1p = buf1_21[i - 1];
        const b2p = buf2_21[i - 1];
        const idx5 = htf5m.lastClosedBarIdx[i];

        if (!isNaN(b1c) && !isNaN(b2c) && !isNaN(b1p) && !isNaN(b2p) && idx5 >= 0) {
          const crossUp1m = b1c > b2c && b1p <= b2p;
          const crossDn1m = b1c < b2c && b1p >= b2p;
          const curAdx5 = adx5m.adx[idx5];
          const curPlus5 = adx5m.plusDI[idx5];
          const curMinus5 = adx5m.minusDI[idx5];

          if (!isNaN(curAdx5) && !isNaN(curPlus5) && !isNaN(curMinus5) && curAdx5 >= 30) {
            if (crossUp1m && candles[i].close > pdh && (curPlus5 - curMinus5) > 5) {
              if (res.rawCallSignals) res.rawCallSignals[i] = true;
              if (config.visibleBuy !== false) {
                res.callSignals[i] = true;
                res.samSignalProfile![i] = aftProfile;
                res.sam21AfternoonSignalCount = (res.sam21AfternoonSignalCount || 0) + 1;
              }
            } else if (crossDn1m && candles[i].close < pdl && (curMinus5 - curPlus5) > 5) {
              if (res.rawPutSignals) res.rawPutSignals[i] = true;
              if (config.visibleSell !== false) {
                res.putSignals[i] = true;
                res.samSignalProfile![i] = aftProfile;
                res.sam21AfternoonSignalCount = (res.sam21AfternoonSignalCount || 0) + 1;
              }
            }
          }
        }
      }
    }

    // 6. Populate live status for the latest bar so UI clearly shows active evaluation on current data
    const lastIdx = len - 1;
    const lastMeta = barMeta[lastIdx];
    if (lastMeta) {
      const latestPdh = isNaN(pdhArr[lastIdx]) ? null : Number(pdhArr[lastIdx].toFixed(2));
      const latestPdl = isNaN(pdlArr[lastIdx]) ? null : Number(pdlArr[lastIdx].toFixed(2));
      const latestClose = Number(candles[lastIdx].close.toFixed(2));
      const idx5 = htf5m.lastClosedBarIdx[lastIdx];
      const latestAdx5m =
        idx5 >= 0 && !isNaN(adx5m.adx[idx5]) ? Number(adx5m.adx[idx5].toFixed(1)) : null;
      const latestDiSpread5m =
        idx5 >= 0 && !isNaN(adx5m.plusDI[idx5]) && !isNaN(adx5m.minusDI[idx5])
          ? Number((adx5m.plusDI[idx5] - adx5m.minusDI[idx5]).toFixed(1))
          : null;
      const idx15 = htf15m ? htf15m.lastClosedBarIdx[lastIdx] : -1;
      const latestSt15mDir = st15mDir && idx15 >= 0 ? st15mDir[idx15] : 0;

      const d = new Date(lastMeta.dayKey * 86400 * 1000);
      const latestDate = d.toISOString().slice(0, 10);
      const hh = String(Math.floor(lastMeta.mins / 60)).padStart(2, '0');
      const mm = String(lastMeta.mins % 60).padStart(2, '0');

      let breakoutState: 'ABOVE_PDH' | 'BELOW_PDL' | 'INSIDE_RANGE' | 'NO_PDH_PDL' = 'NO_PDH_PDL';
      if (latestPdh !== null && latestPdl !== null) {
        if (latestClose > latestPdh) breakoutState = 'ABOVE_PDH';
        else if (latestClose < latestPdl) breakoutState = 'BELOW_PDL';
        else breakoutState = 'INSIDE_RANGE';
      }

      res.sam21LiveStatus = {
        latestDate,
        latestTimeIst: `${hh}:${mm}`,
        latestClose,
        pdh: latestPdh,
        pdl: latestPdl,
        adx5m: latestAdx5m,
        diSpread5m: latestDiSpread5m,
        st15mDir: latestSt15mDir,
        inputBarMinutes,
        breakoutState,
      };
    }

    return res;
  }

  if (len < Math.max(config.maSlowPeriod, config.maFastPeriod) + config.signalPeriod) {
    return res;
  }

  // 1. Extract values series based on source
  const values: number[] = candles.map(c => {
    switch (config.source) {
      case 'hl2':
        return (c.high + c.low) / 2;
      case 'hlc3':
        return (c.high + c.low + c.close) / 3;
      case 'ohlc4':
        return (c.open + c.high + c.low + c.close) / 4;
      case 'close':
      default:
        return c.close;
    }
  });

  // 2. smaFast = ta.sma(MaValue, MaFast_period)
  const smaFast = config.maFastPeriod === 1 ? [...values] : computeSMA(values, config.maFastPeriod);
  res.smaFast = smaFast;

  // 3. smaSlow = ta.sma(MaValue, MaSlow_period)
  const smaSlow = computeSMA(values, config.maSlowPeriod);
  res.smaSlow = smaSlow;

  // 4. buffer1 = smaFast - smaSlow
  const buffer1: number[] = new Array(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    if (!isNaN(smaFast[i]) && !isNaN(smaSlow[i])) {
      buffer1[i] = smaFast[i] - smaSlow[i];
    }
  }
  res.buffer1 = buffer1;

  // 5. buffer2 = ta.wma(buffer1, Signal_period)
  const buffer2 = computeWMA(buffer1, config.signalPeriod);
  res.buffer2 = buffer2;

  // 6. Optional ADX / DI Indicators (also required by S12 Confluence Filter)
  let adxData: { adx: number[]; plusDI: number[]; minusDI: number[] } | null = null;
  if (config.adxFilterEnabled || config.filterS12ConfluenceEnabled) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    adxData = computeADX(highs, lows, closes, config.adxPeriod || 14);
    res.adxValues = adxData.adx;
    res.plusDI = adxData.plusDI;
    res.minusDI = adxData.minusDI;
  }

  // 6.1 S12 Confluence Filter indicators (Strictly Causal: DI Spread > +5, EMA 100/200 Alignment, RVOL >= 0.70)
  let s12EmaFast: number[] | null = null;
  let s12EmaSlow: number[] | null = null;
  let s12VolSma20: number[] | null = null;
  if (config.filterS12ConfluenceEnabled) {
    const closes = candles.map(c => c.close);
    const vols = candles.map(c => c.volume ?? 0);
    s12EmaFast = computeEMA(closes, config.s12EmaFastPeriod ?? 100);
    s12EmaSlow = computeEMA(closes, config.s12EmaSlowPeriod ?? 200);
    s12VolSma20 = computeSMA(vols, 20);
    res.ema100Values = s12EmaFast;
    res.ema200Values = s12EmaSlow;
  }

  const passesS12Confluence = (barIdx: number, direction: 'CALL' | 'PUT'): boolean => {
    if (!config.filterS12ConfluenceEnabled) return true;
    if (!adxData || !s12EmaFast || !s12EmaSlow || !s12VolSma20) return false;
    const candle = candles[barIdx];
    if (!candle) return false;

    const dir = direction === 'CALL' ? 1 : -1;
    const minDiSpread = config.s12DiSpreadMin ?? 5;
    const minRvol = config.s12MinRvol ?? 0.7;

    // 1. Directional Momentum: DI Spread > +5
    const plus = adxData.plusDI[barIdx];
    const minus = adxData.minusDI[barIdx];
    if (plus === undefined || minus === undefined || isNaN(plus) || isNaN(minus)) return false;
    if (!(dir * (plus - minus) > minDiSpread)) return false;

    // 2. Macro Trend Alignment: Price on right side of both EMA100 & EMA200
    const eFast = s12EmaFast[barIdx];
    const eSlow = s12EmaSlow[barIdx];
    if (isNaN(eFast) || isNaN(eSlow)) return false;
    if (!(dir * (candle.close - eFast) > 0 && dir * (candle.close - eSlow) > 0)) return false;

    // 3. Volume Participation: RVOL >= 0.70 (falls back to 1.0 if feed has no volume)
    const avgVol = s12VolSma20[barIdx];
    const rvol = (!isNaN(avgVol) && avgVol > 0) ? ((candle.volume ?? 0) / avgVol) : 1;
    if (rvol < minRvol) return false;

    return true;
  };

  // 6.2 Intraday VWAP & Dynamic Regime Classification (for adaptive filter & chart display)
  let vwapValues: number[] | null = null;
  if (config.vwapFilterEnabled || config.adaptiveRegimeEnabled || config.showVwapLine) {
    vwapValues = computeVWAP(candles);
    res.vwapValues = vwapValues;

    // Dynamic Regime Classification per bar
    const trendDist = config.adaptiveTrendDistancePoints ?? 20;
    const regimeArr: ('TREND_BULL' | 'TREND_BEAR' | 'RANGE')[] = new Array(len).fill('RANGE');
    for (let idx = 1; idx < len; idx++) {
      const curV = vwapValues[idx];
      const prevV = vwapValues[idx - 1];
      const c = candles[idx];
      if (!isNaN(curV) && !isNaN(prevV) && c) {
        const dist = c.close - curV;
        const slope = curV - prevV;
        if (dist >= trendDist && slope > 0) {
          regimeArr[idx] = 'TREND_BULL';
        } else if (dist <= -trendDist && slope < 0) {
          regimeArr[idx] = 'TREND_BEAR';
        } else {
          regimeArr[idx] = 'RANGE';
        }
      }
    }
    res.regimeState = regimeArr;
  }

  // 6.3 5-Minute Higher Timeframe (MTF) EMA Trend Alignment
  let mtfEmaData: { ema: number[]; slope: number[] } | null = null;
  if (config.filterMtfEmaEnabled) {
    mtfEmaData = compute5MinEMA(candles, config.mtfEmaPeriod || 20);
    res.mtfEmaValues = mtfEmaData.ema;
    res.mtfEmaSlopes = mtfEmaData.slope;
  }

  // 6.4 Session Day High & Day Low Tracking (for Range Boundary Trap Filter)
  const dayHighsBeforeBar: number[] = new Array(len).fill(NaN);
  const dayLowsBeforeBar: number[] = new Array(len).fill(NaN);
  let runningDayKey: number | string = -1;
  let curDayHigh = -Infinity;
  let curDayLow = Infinity;
  let curDayBars = 0;

  for (let idx = 0; idx < len; idx++) {
    const c = candles[idx];
    let dayKey: number | string = -1;
    if (typeof c.time === 'number') {
      dayKey = Math.floor(c.time / 86400);
    } else if (c.timestamp) {
      try {
        const d = new Date(c.timestamp);
        const istEpochMs = d.getTime() + 19800000;
        dayKey = Math.floor(istEpochMs / 86400000);
      } catch (_) {
        dayKey = typeof c.timestamp === 'string' ? c.timestamp.split('T')[0] : -1;
      }
    }

    if (dayKey !== -1 && dayKey !== runningDayKey) {
      runningDayKey = dayKey;
      curDayHigh = c.high;
      curDayLow = c.low;
      curDayBars = 1;
      dayHighsBeforeBar[idx] = curDayHigh;
      dayLowsBeforeBar[idx] = curDayLow;
    } else {
      dayHighsBeforeBar[idx] = curDayHigh;
      dayLowsBeforeBar[idx] = curDayLow;
      curDayHigh = Math.max(curDayHigh, c.high);
      curDayLow = Math.min(curDayLow, c.low);
      curDayBars++;
    }
  }
  res.currentDayHighs = dayHighsBeforeBar;
  res.currentDayLows = dayLowsBeforeBar;

  // 7. Conditions:
  // buyCondition = (buffer1 > buffer2 and buffer1[1] < buffer2[1]) -> CALL
  // sellCondition = (buffer1 < buffer2 and buffer1[1] > buffer2[1]) -> PUT
  for (let i = 1; i < len; i++) {
    const b1Curr = buffer1[i];
    const b2Curr = buffer2[i];
    const b1Prev = buffer1[i - 1];
    const b2Prev = buffer2[i - 1];

    if (isNaN(b1Curr) || isNaN(b2Curr) || isNaN(b1Prev) || isNaN(b2Prev)) {
      continue;
    }

    const rawBuy = b1Curr > b2Curr && b1Prev <= b2Prev;
    const rawSell = b1Curr < b2Curr && b1Prev >= b2Prev;

    if (rawBuy && res.rawCallSignals) res.rawCallSignals[i] = true;
    if (rawSell && res.rawPutSignals) res.rawPutSignals[i] = true;

    // 1. Adverse Rejection Wick Filter (>35% wick opposing trade)
    // For LONG: Upper wick / Range > maxWickPct (default 35%)
    // For SHORT: Lower wick / Range > maxWickPct (default 35%)
    let passWickBuy = true;
    let passWickSell = true;
    if (config.filterRejectionWickEnabled) {
      const c = candles[i];
      if (c) {
        const cRange = c.high - c.low;
        const maxWickPct = config.rejectionWickMaxPercent ?? 35;
        if (cRange > 0) {
          const upperWick = c.high - Math.max(c.open, c.close);
          if ((upperWick / cRange) * 100 > maxWickPct) {
            passWickBuy = false;
            if (rawBuy && res.wickFilteredCount !== undefined) res.wickFilteredCount++;
          }
          const lowerWick = Math.min(c.open, c.close) - c.low;
          if ((lowerWick / cRange) * 100 > maxWickPct) {
            passWickSell = false;
            if (rawSell && res.wickFilteredCount !== undefined) res.wickFilteredCount++;
          }
        }
      }
    }

    // 1.2 Minimum Candle Body Filter (Kill Dojis & Low-Energy Candles)
    let passMinBodyBuy = true;
    let passMinBodySell = true;
    if (config.filterMinBodyEnabled) {
      const c = candles[i];
      if (c) {
        const cRange = c.high - c.low;
        const bodyHeight = Math.abs(c.close - c.open);
        const minPts = config.minBodyPoints ?? 7;
        const minPct = config.minBodyRatioPercent ?? 45;
        const bodyRatio = cRange > 0 ? (bodyHeight / cRange) * 100 : 0;
        if (cRange <= 0 || bodyHeight < minPts || bodyRatio < minPct) {
          passMinBodyBuy = false;
          passMinBodySell = false;
          if (rawBuy && res.minBodyFilteredCount !== undefined) res.minBodyFilteredCount++;
          if (rawSell && res.minBodyFilteredCount !== undefined) res.minBodyFilteredCount++;
        }
      }
    }

    // 1.3 5-Minute Higher Timeframe (MTF) EMA Trend Alignment
    let passMtfEmaBuy = true;
    let passMtfEmaSell = true;
    if (config.filterMtfEmaEnabled && mtfEmaData) {
      const curEma = mtfEmaData.ema[i];
      const curSlope = mtfEmaData.slope[i];
      const c = candles[i];
      if (!isNaN(curEma) && c) {
        const callPass = config.mtfEmaRequireSlope ? (c.close >= curEma && curSlope >= 0) : (c.close >= curEma || curSlope > 0);
        const putPass = config.mtfEmaRequireSlope ? (c.close <= curEma && curSlope <= 0) : (c.close <= curEma || curSlope < 0);
        if (!callPass) {
          passMtfEmaBuy = false;
          if (rawBuy && passWickBuy && passMinBodyBuy && res.mtfEmaFilteredCount !== undefined) {
            res.mtfEmaFilteredCount++;
          }
        }
        if (!putPass) {
          passMtfEmaSell = false;
          if (rawSell && passWickSell && passMinBodySell && res.mtfEmaFilteredCount !== undefined) {
            res.mtfEmaFilteredCount++;
          }
        }
      }
    }

    // 1.4 Day High / Day Low Trap Filter (Range Boundary Exhaustion)
    let passDayTrapBuy = true;
    let passDayTrapSell = true;
    if (config.filterDayTrapEnabled) {
      const dHigh = dayHighsBeforeBar[i];
      const dLow = dayLowsBeforeBar[i];
      const trapDist = config.dayTrapBufferPoints ?? 10;
      const c = candles[i];
      if (c && !isNaN(dHigh) && dHigh > 0 && dHigh !== -Infinity) {
        // CALL trapped: Close is below Day High, but within danger buffer points
        if (c.close < dHigh && (dHigh - c.close) <= trapDist) {
          passDayTrapBuy = false;
          if (rawBuy && passWickBuy && passMinBodyBuy && res.dayTrapFilteredCount !== undefined) {
            res.dayTrapFilteredCount++;
          }
        }
      }
      if (c && !isNaN(dLow) && dLow > 0 && dLow !== Infinity) {
        // PUT trapped: Close is above Day Low, but within danger buffer points
        if (c.close > dLow && (c.close - dLow) <= trapDist) {
          passDayTrapSell = false;
          if (rawSell && passWickSell && passMinBodySell && res.dayTrapFilteredCount !== undefined) {
            res.dayTrapFilteredCount++;
          }
        }
      }
    }

    // 2. ADX Filter check
    let passAdxBuy = true;
    let passAdxSell = true;
    if (config.adxFilterEnabled && adxData) {
      const curAdx = adxData.adx[i];
      const threshold = config.adxThreshold || 20;
      const isStrong = !isNaN(curAdx) && curAdx >= threshold;

      if (config.adxRequireDirectional) {
        passAdxBuy = isStrong && !isNaN(adxData.plusDI[i]) && !isNaN(adxData.minusDI[i]) && (adxData.plusDI[i] >= adxData.minusDI[i]);
        passAdxSell = isStrong && !isNaN(adxData.plusDI[i]) && !isNaN(adxData.minusDI[i]) && (adxData.minusDI[i] >= adxData.plusDI[i]);
      } else {
        passAdxBuy = isStrong;
        passAdxSell = isStrong;
      }
    }

    // 3. Pre-market session restriction: strictly no trade before 09:15 AM IST
    let passPreMarket = true;
    let istMins = -1;
    const c = candles[i];
    if (c) {
      if (typeof c.time === 'number') {
        const d = new Date(c.time * 1000);
        const rawUtcMins = d.getUTCHours() * 60 + d.getUTCMinutes();
        // If c.time was shifted by +19800 for IST display, rawUtcMins is in 540..960 range
        istMins = (rawUtcMins >= 540 && rawUtcMins <= 960) ? rawUtcMins : (rawUtcMins + 330) % 1440;
        if (config.noTradeBefore915 !== false && istMins < 9 * 60 + 15) {
          passPreMarket = false;
        }
      } else if (c.timestamp) {
        try {
          const d = new Date(c.timestamp);
          const rawUtcMins = d.getUTCHours() * 60 + d.getUTCMinutes();
          istMins = (rawUtcMins + 330) % 1440;
          if (config.noTradeBefore915 !== false && istMins < 9 * 60 + 15) {
            passPreMarket = false;
          }
        } catch (_) {}
      }
    }

    // 4. Smart Intraday VWAP & Dynamic Regime Filter:
    // When adaptiveRegimeEnabled is true:
    //   - Bull Trend Mode: CALL favored, PUT blocked (unless deep climax fade >= climaxBand)
    //   - Bear Trend Mode: PUT favored, CALL blocked (unless deep climax bounce <= -climaxBand)
    //   - Range Mode: Both CALL and PUT allowed (enables winning dip-buys), but climax exhaustion (> climaxBand) blocked!
    // When adaptiveRegimeEnabled is false: classic static VWAP filter.
    let passVwapBuy = true;
    let passVwapSell = true;
    const isAdaptive = config.adaptiveRegimeEnabled !== false;
    const climaxBand = config.adaptiveClimaxBandPoints ?? (config.vwapMaxDistancePoints ?? 50);
    const allowRev = config.adaptiveAllowReversionBounce !== false;
    const maxVwapDist = config.vwapMaxDistancePoints ?? 70;
    const climaxProtection = config.vwapClimaxFilterEnabled !== false;

    if ((config.vwapFilterEnabled || isAdaptive) && vwapValues) {
      const curVwap = vwapValues[i];
      if (!isNaN(curVwap) && c) {
        const distFromVwap = c.close - curVwap;
        const curRegime = res.regimeState?.[i] || 'RANGE';

        // Opening buffer check (< 09:25 IST)
        if (config.vwapOpeningBufferEnabled && istMins >= 0 && istMins < 9 * 60 + 25) {
          passVwapBuy = false;
          passVwapSell = false;
          if ((rawBuy || rawSell) && passWickBuy && passWickSell && passPreMarket) {
            if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
            res.vwapFilterDetails?.push({
              barIdx: i,
              time: c.time || c.timestamp,
              direction: rawBuy ? 'CALL' : 'PUT',
              price: c.close,
              vwap: curVwap,
              stage: 'SETUP_BAR',
              distance: Number(Math.abs(distFromVwap).toFixed(2)),
            });
          }
        }

        if (isAdaptive) {
          // Dynamic Adaptive Dual-Mode Regime Logic
          if (passVwapBuy) {
            if (curRegime === 'TREND_BEAR') {
              if (allowRev && distFromVwap <= -climaxBand) {
                passVwapBuy = true; // Deep panic oversold bounce allowed!
              } else {
                passVwapBuy = false; // Block counter-trend CALL in active Bear Trend
                if (rawBuy && passWickBuy && passAdxBuy && passPreMarket) {
                  if (res.adaptiveFilteredCount !== undefined) res.adaptiveFilteredCount++;
                  if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
                  res.vwapFilterDetails?.push({
                    barIdx: i,
                    time: c.time || c.timestamp,
                    direction: 'CALL',
                    price: c.close,
                    vwap: curVwap,
                    stage: 'SETUP_BAR',
                    distance: Number((curVwap - c.close).toFixed(2)),
                  });
                }
              }
            } else if (curRegime === 'RANGE') {
              if (distFromVwap > climaxBand) {
                passVwapBuy = false; // Block buying into climax exhaustion top
                if (rawBuy && passWickBuy && passAdxBuy && passPreMarket) {
                  if (res.adaptiveFilteredCount !== undefined) res.adaptiveFilteredCount++;
                  if (res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
                  res.vwapFilterDetails?.push({
                    barIdx: i,
                    time: c.time || c.timestamp,
                    direction: 'CALL',
                    price: c.close,
                    vwap: curVwap,
                    stage: 'SETUP_BAR',
                    distance: Number(distFromVwap.toFixed(2)),
                  });
                }
              }
            }
          }

          if (passVwapSell) {
            if (curRegime === 'TREND_BULL') {
              if (allowRev && distFromVwap >= climaxBand) {
                passVwapSell = true; // Deep euphoria overbought fade allowed!
              } else {
                passVwapSell = false; // Block counter-trend PUT in active Bull Trend
                if (rawSell && passWickSell && passAdxSell && passPreMarket) {
                  if (res.adaptiveFilteredCount !== undefined) res.adaptiveFilteredCount++;
                  if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
                  res.vwapFilterDetails?.push({
                    barIdx: i,
                    time: c.time || c.timestamp,
                    direction: 'PUT',
                    price: c.close,
                    vwap: curVwap,
                    stage: 'SETUP_BAR',
                    distance: Number(distFromVwap.toFixed(2)),
                  });
                }
              }
            } else if (curRegime === 'RANGE') {
              if (distFromVwap < -climaxBand) {
                passVwapSell = false; // Block shorting into panic exhaustion bottom
                if (rawSell && passWickSell && passAdxSell && passPreMarket) {
                  if (res.adaptiveFilteredCount !== undefined) res.adaptiveFilteredCount++;
                  if (res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
                  res.vwapFilterDetails?.push({
                    barIdx: i,
                    time: c.time || c.timestamp,
                    direction: 'PUT',
                    price: c.close,
                    vwap: curVwap,
                    stage: 'SETUP_BAR',
                    distance: Number((curVwap - c.close).toFixed(2)),
                  });
                }
              }
            }
          }
        } else if (config.vwapFilterEnabled) {
          // Classic Static VWAP Trend & Climax Check
          if (passVwapBuy) {
            if (c.close < curVwap) {
              passVwapBuy = false;
              if (rawBuy && passWickBuy && passAdxBuy && passPreMarket) {
                if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
                res.vwapFilterDetails?.push({
                  barIdx: i,
                  time: c.time || c.timestamp,
                  direction: 'CALL',
                  price: c.close,
                  vwap: curVwap,
                  stage: 'SETUP_BAR',
                  distance: Number((curVwap - c.close).toFixed(2)),
                });
              }
            } else if (climaxProtection && (c.close - curVwap) > maxVwapDist) {
              passVwapBuy = false;
              if (rawBuy && passWickBuy && passAdxBuy && passPreMarket) {
                if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
                if (res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
                res.vwapFilterDetails?.push({
                  barIdx: i,
                  time: c.time || c.timestamp,
                  direction: 'CALL',
                  price: c.close,
                  vwap: curVwap,
                  stage: 'SETUP_BAR',
                  distance: Number((c.close - curVwap).toFixed(2)),
                });
              }
            }
          }

          if (passVwapSell) {
            if (c.close > curVwap) {
              passVwapSell = false;
              if (rawSell && passWickSell && passAdxSell && passPreMarket) {
                if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
                res.vwapFilterDetails?.push({
                  barIdx: i,
                  time: c.time || c.timestamp,
                  direction: 'PUT',
                  price: c.close,
                  vwap: curVwap,
                  stage: 'SETUP_BAR',
                  distance: Number((c.close - curVwap).toFixed(2)),
                });
              }
            } else if (climaxProtection && (curVwap - c.close) > maxVwapDist) {
              passVwapSell = false;
              if (rawSell && passWickSell && passAdxSell && passPreMarket) {
                if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
                if (res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
                res.vwapFilterDetails?.push({
                  barIdx: i,
                  time: c.time || c.timestamp,
                  direction: 'PUT',
                  price: c.close,
                  vwap: curVwap,
                  stage: 'SETUP_BAR',
                  distance: Number((curVwap - c.close).toFixed(2)),
                });
              }
            }
          }
        }
      }
    }

    const timing = config.entryTiming ?? 'bar1Close';

    // Base Candidate Setups on Bar 0 (prior to VWAP suppression)
    const baseSetupBuy = rawBuy && passWickBuy && passMinBodyBuy && passMtfEmaBuy && passDayTrapBuy && passPreMarket && passAdxBuy;
    const baseSetupSell = rawSell && passWickSell && passMinBodySell && passMtfEmaSell && passDayTrapSell && passPreMarket && passAdxSell;

    // Filtered Candidate Setups on Bar 0
    const setupBuy = baseSetupBuy && ((config.vwapFilterEnabled || isAdaptive) ? passVwapBuy : true);
    const setupSell = baseSetupSell && ((config.vwapFilterEnabled || isAdaptive) ? passVwapSell : true);

    if (timing === 'bar1Close') {
      if (res.candidateCallSignals) {
        res.candidateCallSignals[i] = setupBuy;
      }
      if (res.candidatePutSignals) {
        res.candidatePutSignals[i] = setupSell;
      }

      // 2. Check if previous candle (i - 1) formed a candidate setup.
      // Candle i is the Immediate Adverse Bar + 1!
      // If candle i passes the adverse filter (closes in favorable direction),
      // confirmed trade entry is taken at candle i (Bar + 1) CLOSE.
      if (i >= 1) {
        const curC = candles[i];
        const prevC = candles[i - 1];
        const curVwap = vwapValues?.[i] ?? NaN;

        // Populate base unblocked reversal signals for autoExitOpposite
        if (res.rawCallSignals?.[i - 1]) {
          const isAdverse = (curC.close < curC.open || curC.close < prevC.close);
          if (!config.filterBar1AdverseCloseEnabled || !isAdverse) {
            if (res.baseCallSignals) res.baseCallSignals[i] = true;
          }
        }
        if (res.rawPutSignals?.[i - 1]) {
          const isAdverse = (curC.close > curC.open || curC.close > prevC.close);
          if (!config.filterBar1AdverseCloseEnabled || !isAdverse) {
            if (res.basePutSignals) res.basePutSignals[i] = true;
          }
        }

        // CALL Signal Evaluation on Bar + 1 Close
        if (res.candidateCallSignals?.[i - 1]) {
          const isAdverse = (curC.close < curC.open || curC.close < prevC.close);
          
          let breaksVwap = false;
          let breaksVwapClimax = false;
          if (isAdaptive && !isNaN(curVwap)) {
            const bar1Dist = curC.close - curVwap;
            const bar1Regime = res.regimeState?.[i] || 'RANGE';
            if (bar1Regime === 'TREND_BEAR') {
              if (allowRev && bar1Dist <= -climaxBand) {
                breaksVwap = false; // Oversold bottom bounce permitted!
              } else {
                breaksVwap = true;
              }
            } else if (bar1Regime === 'RANGE') {
              if (bar1Dist > climaxBand) {
                breaksVwap = true;
                breaksVwapClimax = true;
              }
            }
          } else if (config.vwapFilterEnabled && !isNaN(curVwap)) {
            const breaksVwapTrend = curC.close < curVwap;
            breaksVwapClimax = climaxProtection && (curC.close - curVwap) > maxVwapDist;
            breaksVwap = breaksVwapTrend || breaksVwapClimax;
          }

          // Check Day High Trap at Bar + 1 close
          const dHigh = dayHighsBeforeBar[i];
          const trapDist = config.dayTrapBufferPoints ?? 10;
          const breaksDayTrap = config.filterDayTrapEnabled && !isNaN(dHigh) && dHigh > 0 && dHigh !== -Infinity && curC.close < dHigh && (dHigh - curC.close) <= trapDist;

          // Check 5m EMA trend at Bar + 1 close
          let breaksMtfEma = false;
          if (config.filterMtfEmaEnabled && mtfEmaData) {
            const cur5mEma = mtfEmaData.ema[i];
            const cur5mSlope = mtfEmaData.slope[i];
            if (!isNaN(cur5mEma)) {
              breaksMtfEma = config.mtfEmaRequireSlope ? (curC.close < cur5mEma || cur5mSlope < 0) : (curC.close < cur5mEma && cur5mSlope <= 0);
            }
          }

          // Check S12 Confluence Filter at Bar + 1 close (DI Spread > +5, EMA100/200 aligned, RVOL >= 0.70)
          const breaksS12 = config.filterS12ConfluenceEnabled ? !passesS12Confluence(i, 'CALL') : false;

          if ((config.filterBar1AdverseCloseEnabled && isAdverse) || breaksVwap || breaksDayTrap || breaksMtfEma || breaksS12) {
            if (breaksVwap) {
              if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
              if (breaksVwapClimax && res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
              if (isAdaptive && res.adaptiveFilteredCount !== undefined) res.adaptiveFilteredCount++;
              res.vwapFilterDetails?.push({
                barIdx: i,
                time: curC.time || curC.timestamp,
                direction: 'CALL',
                price: curC.close,
                vwap: curVwap,
                stage: 'CONFIRMATION_BAR',
                distance: Number(Math.abs(curC.close - curVwap).toFixed(2)),
              });
            }
            if (breaksDayTrap && res.dayTrapFilteredCount !== undefined) res.dayTrapFilteredCount++;
            if (breaksMtfEma && res.mtfEmaFilteredCount !== undefined) res.mtfEmaFilteredCount++;
            if (isAdverse && res.bar1FilteredCount !== undefined) res.bar1FilteredCount++;
            if (breaksS12 && !(config.filterBar1AdverseCloseEnabled && isAdverse) && !breaksVwap && !breaksDayTrap && !breaksMtfEma && res.s12FilteredCount !== undefined) {
              res.s12FilteredCount++;
            }
          } else {
            // Passed! Fire confirmed entry signal at candle i (Bar + 1) close!
            res.callSignals[i] = config.visibleBuy !== false;
            if (res.candidateCallSignals) res.candidateCallSignals[i] = false;
          }
        }

        // PUT Signal Evaluation on Bar + 1 Close
        if (res.candidatePutSignals?.[i - 1]) {
          const isAdverse = (curC.close > curC.open || curC.close > prevC.close);
          
          let breaksVwap = false;
          let breaksVwapClimax = false;
          if (isAdaptive && !isNaN(curVwap)) {
            const bar1Dist = curC.close - curVwap;
            const bar1Regime = res.regimeState?.[i] || 'RANGE';
            if (bar1Regime === 'TREND_BULL') {
              if (allowRev && bar1Dist >= climaxBand) {
                breaksVwap = false; // Overbought top fade permitted!
              } else {
                breaksVwap = true;
              }
            } else if (bar1Regime === 'RANGE') {
              if (bar1Dist < -climaxBand) {
                breaksVwap = true;
                breaksVwapClimax = true;
              }
            }
          } else if (config.vwapFilterEnabled && !isNaN(curVwap)) {
            const breaksVwapTrend = curC.close > curVwap;
            breaksVwapClimax = climaxProtection && (curVwap - curC.close) > maxVwapDist;
            breaksVwap = breaksVwapTrend || breaksVwapClimax;
          }

          // Check Day Low Trap at Bar + 1 close
          const dLow = dayLowsBeforeBar[i];
          const trapDist = config.dayTrapBufferPoints ?? 10;
          const breaksDayTrap = config.filterDayTrapEnabled && !isNaN(dLow) && dLow > 0 && dLow !== Infinity && curC.close > dLow && (curC.close - dLow) <= trapDist;

          // Check 5m EMA trend at Bar + 1 close
          let breaksMtfEma = false;
          if (config.filterMtfEmaEnabled && mtfEmaData) {
            const cur5mEma = mtfEmaData.ema[i];
            const cur5mSlope = mtfEmaData.slope[i];
            if (!isNaN(cur5mEma)) {
              breaksMtfEma = config.mtfEmaRequireSlope ? (curC.close > cur5mEma || cur5mSlope > 0) : (curC.close > cur5mEma && cur5mSlope >= 0);
            }
          }

          // Check S12 Confluence Filter at Bar + 1 close (DI Spread > +5, EMA100/200 aligned, RVOL >= 0.70)
          const breaksS12 = config.filterS12ConfluenceEnabled ? !passesS12Confluence(i, 'PUT') : false;

          if ((config.filterBar1AdverseCloseEnabled && isAdverse) || breaksVwap || breaksDayTrap || breaksMtfEma || breaksS12) {
            if (breaksVwap) {
              if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
              if (breaksVwapClimax && res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
              if (isAdaptive && res.adaptiveFilteredCount !== undefined) res.adaptiveFilteredCount++;
              res.vwapFilterDetails?.push({
                barIdx: i,
                time: curC.time || curC.timestamp,
                direction: 'PUT',
                price: curC.close,
                vwap: curVwap,
                stage: 'CONFIRMATION_BAR',
                distance: Number(Math.abs(curC.close - curVwap).toFixed(2)),
              });
            }
            if (breaksDayTrap && res.dayTrapFilteredCount !== undefined) res.dayTrapFilteredCount++;
            if (breaksMtfEma && res.mtfEmaFilteredCount !== undefined) res.mtfEmaFilteredCount++;
            if (isAdverse && res.bar1FilteredCount !== undefined) res.bar1FilteredCount++;
            if (breaksS12 && !(config.filterBar1AdverseCloseEnabled && isAdverse) && !breaksVwap && !breaksDayTrap && !breaksMtfEma && res.s12FilteredCount !== undefined) {
              res.s12FilteredCount++;
            }
          } else {
            // Passed! Fire confirmed entry signal at candle i (Bar + 1) close!
            res.putSignals[i] = config.visibleSell !== false;
            if (res.candidatePutSignals) res.candidatePutSignals[i] = false;
          }
        }
      }
    } else if (timing === 'bar1Open') {
      if (res.candidateCallSignals) res.candidateCallSignals[i] = setupBuy;
      if (res.candidatePutSignals) res.candidatePutSignals[i] = setupSell;

      if (i >= 1) {
        const curC = candles[i];
        const curVwap = vwapValues?.[i] ?? NaN;

        if (res.rawCallSignals?.[i - 1]) {
          if (res.baseCallSignals) res.baseCallSignals[i] = true;
        }
        if (res.rawPutSignals?.[i - 1]) {
          if (res.basePutSignals) res.basePutSignals[i] = true;
        }

        if (res.candidateCallSignals?.[i - 1]) {
          const breaksVwapTrend = config.vwapFilterEnabled && !isNaN(curVwap) && curC.open < curVwap;
          const breaksVwapClimax = config.vwapFilterEnabled && climaxProtection && !isNaN(curVwap) && (curC.open - curVwap) > maxVwapDist;
          const breaksVwap = breaksVwapTrend || breaksVwapClimax;
          // Evaluate S12 strictly on completed bar (i - 1) so bar1Open entry has zero lookahead
          const breaksS12 = config.filterS12ConfluenceEnabled ? !passesS12Confluence(i - 1, 'CALL') : false;

          if (breaksVwap || breaksS12) {
            if (breaksVwap) {
              if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
              if (breaksVwapClimax && res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
              res.vwapFilterDetails?.push({
                barIdx: i,
                time: curC.time || curC.timestamp,
                direction: 'CALL',
                price: curC.open,
                vwap: curVwap,
                stage: 'CONFIRMATION_BAR',
                distance: Number(Math.abs(curC.open - curVwap).toFixed(2)),
              });
            } else if (breaksS12 && res.s12FilteredCount !== undefined) {
              res.s12FilteredCount++;
            }
          } else {
            res.callSignals[i] = config.visibleBuy !== false;
          }
        }
        if (res.candidatePutSignals?.[i - 1]) {
          const breaksVwapTrend = config.vwapFilterEnabled && !isNaN(curVwap) && curC.open > curVwap;
          const breaksVwapClimax = config.vwapFilterEnabled && climaxProtection && !isNaN(curVwap) && (curVwap - curC.open) > maxVwapDist;
          const breaksVwap = breaksVwapTrend || breaksVwapClimax;
          const breaksS12 = config.filterS12ConfluenceEnabled ? !passesS12Confluence(i - 1, 'PUT') : false;

          if (breaksVwap || breaksS12) {
            if (breaksVwap) {
              if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
              if (breaksVwapClimax && res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
              res.vwapFilterDetails?.push({
                barIdx: i,
                time: curC.time || curC.timestamp,
                direction: 'PUT',
                price: curC.open,
                vwap: curVwap,
                stage: 'CONFIRMATION_BAR',
                distance: Number(Math.abs(curC.open - curVwap).toFixed(2)),
              });
            } else if (breaksS12 && res.s12FilteredCount !== undefined) {
              res.s12FilteredCount++;
            }
          } else {
            res.putSignals[i] = config.visibleSell !== false;
          }
        }
      }
    } else {
      // 'bar0Close': Immediate entry at close of crossover candle i
      let passBar1CloseBuy = true;
      let passBar1CloseSell = true;
      if (config.filterBar1AdverseCloseEnabled && (config.bar1ActionMode ?? 'filter') === 'filter' && i + 1 < len) {
        const nextC = candles[i + 1];
        if (nextC) {
          if (nextC.close < nextC.open || nextC.close < candles[i].close) {
            passBar1CloseBuy = false;
            if (rawBuy && passWickBuy && res.bar1FilteredCount !== undefined) res.bar1FilteredCount++;
          }
          if (nextC.close > nextC.open || nextC.close > candles[i].close) {
            passBar1CloseSell = false;
            if (rawSell && passWickSell && res.bar1FilteredCount !== undefined) res.bar1FilteredCount++;
          }
        }
      }
      if (res.baseCallSignals) res.baseCallSignals[i] = rawBuy && passWickBuy && passBar1CloseBuy && passAdxBuy && passPreMarket;
      if (res.basePutSignals) res.basePutSignals[i] = rawSell && passWickSell && passBar1CloseSell && passAdxSell && passPreMarket;

      const preS12Buy = rawBuy && passWickBuy && passBar1CloseBuy && passAdxBuy && (config.vwapFilterEnabled ? passVwapBuy : true) && passPreMarket;
      const preS12Sell = rawSell && passWickSell && passBar1CloseSell && passAdxSell && (config.vwapFilterEnabled ? passVwapSell : true) && passPreMarket;
      const passS12Buy = !config.filterS12ConfluenceEnabled || passesS12Confluence(i, 'CALL');
      const passS12Sell = !config.filterS12ConfluenceEnabled || passesS12Confluence(i, 'PUT');
      if (preS12Buy && !passS12Buy && res.s12FilteredCount !== undefined) res.s12FilteredCount++;
      if (preS12Sell && !passS12Sell && res.s12FilteredCount !== undefined) res.s12FilteredCount++;

      res.callSignals[i] = preS12Buy && passS12Buy && config.visibleBuy !== false;
      res.putSignals[i] = preS12Sell && passS12Sell && config.visibleSell !== false;
    }
  }

  return res;
}
