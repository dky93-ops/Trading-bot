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

import { computeSMA, computeWMA, computeADX, computeVWAP, compute5MinEMA } from './technical-indicators';

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
  mtfEmaValues?: number[];
  mtfEmaSlopes?: number[];
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
    vwapFilterDetails: [],
  };

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

  // 6. Optional ADX Filter
  let adxData: { adx: number[]; plusDI: number[]; minusDI: number[] } | null = null;
  if (config.adxFilterEnabled) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    adxData = computeADX(highs, lows, closes, config.adxPeriod || 14);
    res.adxValues = adxData.adx;
    res.plusDI = adxData.plusDI;
    res.minusDI = adxData.minusDI;
  }

  // 6.2 Intraday VWAP Calculation (for filter & chart line display)
  let vwapValues: number[] | null = null;
  if (config.vwapFilterEnabled || config.showVwapLine) {
    vwapValues = computeVWAP(candles);
    res.vwapValues = vwapValues;
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

    // 4. Smart Intraday VWAP Filter:
    // (a) Institutional Trend Alignment:
    //     - CALL (Long): Candle close >= VWAP (Bullish institutional control)
    //     - PUT (Short): Candle close <= VWAP (Bearish institutional control)
    // (b) Climax / Overextension Protection:
    //     - CALL: (Close - VWAP) <= maxVwapDistance (Default: 70 pts).
    //       Blocks buying into exhaustion tops (e.g. 13:00 trade at +168 pts above VWAP).
    //     - PUT: (VWAP - Close) <= maxVwapDistance (Default: 70 pts).
    //       Blocks shorting into exhausted panic bottoms.
    // (c) Opening 09:25 Buffer:
    //     - Blocks taking fresh setups in the first 10 minutes when VWAP has too few samples.
    let passVwapBuy = true;
    let passVwapSell = true;
    const maxVwapDist = config.vwapMaxDistancePoints ?? 70;
    const climaxProtection = config.vwapClimaxFilterEnabled !== false;

    if (config.vwapFilterEnabled && vwapValues) {
      const curVwap = vwapValues[i];
      if (!isNaN(curVwap) && c) {
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
              distance: Number(Math.abs(c.close - curVwap).toFixed(2)),
            });
          }
        }

        // Long Trend & Climax Check
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

        // Short Trend & Climax Check
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

    const timing = config.entryTiming ?? 'bar1Close';

    // Base Candidate Setups on Bar 0 (prior to VWAP suppression)
    const baseSetupBuy = rawBuy && passWickBuy && passMinBodyBuy && passMtfEmaBuy && passDayTrapBuy && passPreMarket && passAdxBuy;
    const baseSetupSell = rawSell && passWickSell && passMinBodySell && passMtfEmaSell && passDayTrapSell && passPreMarket && passAdxSell;

    // Filtered Candidate Setups on Bar 0
    const setupBuy = baseSetupBuy && (config.vwapFilterEnabled ? passVwapBuy : true);
    const setupSell = baseSetupSell && (config.vwapFilterEnabled ? passVwapSell : true);

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
          const breaksVwapTrend = config.vwapFilterEnabled && !isNaN(curVwap) && curC.close < curVwap;
          const breaksVwapClimax = config.vwapFilterEnabled && climaxProtection && !isNaN(curVwap) && (curC.close - curVwap) > maxVwapDist;
          const breaksVwap = breaksVwapTrend || breaksVwapClimax;

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

          if ((config.filterBar1AdverseCloseEnabled && isAdverse) || breaksVwap || breaksDayTrap || breaksMtfEma) {
            if (breaksVwap) {
              if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
              if (breaksVwapClimax && res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
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
          } else {
            // Passed! Fire confirmed entry signal at candle i (Bar + 1) close!
            res.callSignals[i] = config.visibleBuy !== false;
            if (res.candidateCallSignals) res.candidateCallSignals[i] = false;
          }
        }

        // PUT Signal Evaluation on Bar + 1 Close
        if (res.candidatePutSignals?.[i - 1]) {
          const isAdverse = (curC.close > curC.open || curC.close > prevC.close);
          const breaksVwapTrend = config.vwapFilterEnabled && !isNaN(curVwap) && curC.close > curVwap;
          const breaksVwapClimax = config.vwapFilterEnabled && climaxProtection && !isNaN(curVwap) && (curVwap - curC.close) > maxVwapDist;
          const breaksVwap = breaksVwapTrend || breaksVwapClimax;

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

          if ((config.filterBar1AdverseCloseEnabled && isAdverse) || breaksVwap || breaksDayTrap || breaksMtfEma) {
            if (breaksVwap) {
              if (res.vwapFilteredCount !== undefined) res.vwapFilteredCount++;
              if (breaksVwapClimax && res.climaxFilteredCount !== undefined) res.climaxFilteredCount++;
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
          } else {
            res.callSignals[i] = config.visibleBuy !== false;
          }
        }
        if (res.candidatePutSignals?.[i - 1]) {
          const breaksVwapTrend = config.vwapFilterEnabled && !isNaN(curVwap) && curC.open > curVwap;
          const breaksVwapClimax = config.vwapFilterEnabled && climaxProtection && !isNaN(curVwap) && (curVwap - curC.open) > maxVwapDist;
          const breaksVwap = breaksVwapTrend || breaksVwapClimax;

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

      res.callSignals[i] = rawBuy && passWickBuy && passBar1CloseBuy && passAdxBuy && (config.vwapFilterEnabled ? passVwapBuy : true) && passPreMarket && config.visibleBuy !== false;
      res.putSignals[i] = rawSell && passWickSell && passBar1CloseSell && passAdxSell && (config.vwapFilterEnabled ? passVwapSell : true) && passPreMarket && config.visibleSell !== false;
    }
  }

  return res;
}
