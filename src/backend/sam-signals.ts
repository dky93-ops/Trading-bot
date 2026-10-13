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

import { computeSMA, computeWMA, computeADX } from './technical-indicators';

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
  filterBar1AdverseCloseEnabled: false,
  bar1ActionMode: 'filter',
  filterBar1ConfirmationEntry: false,
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
  adxValues?: number[];
  plusDI?: number[];
  minusDI?: number[];
  rawCallSignals?: boolean[];
  rawPutSignals?: boolean[];
  wickFilteredCount?: number;
  bar1FilteredCount?: number;
}

export function computeSamSignals(
  candles: Array<{ open: number; high: number; low: number; close: number; time?: any; timestamp?: any }>,
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
    rawCallSignals: new Array(len).fill(false),
    rawPutSignals: new Array(len).fill(false),
    wickFilteredCount: 0,
    bar1FilteredCount: 0,
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

    // 2. Immediate Adverse Close on Bar +1 Filter (Next candle closes in opposite direction of signal)
    // Applied as signal invalidator when bar1ActionMode is 'filter'
    let passBar1CloseBuy = true;
    let passBar1CloseSell = true;
    if (config.filterBar1AdverseCloseEnabled && (config.bar1ActionMode ?? 'filter') === 'filter' && i + 1 < len) {
      const nextC = candles[i + 1];
      if (nextC) {
        // Adverse close for LONG: next candle closes red (close < open) or closes lower than signal bar close
        if (nextC.close < nextC.open || nextC.close < candles[i].close) {
          passBar1CloseBuy = false;
          if (rawBuy && passWickBuy && res.bar1FilteredCount !== undefined) res.bar1FilteredCount++;
        }
        // Adverse close for SHORT: next candle closes green (close > open) or closes higher than signal bar close
        if (nextC.close > nextC.open || nextC.close > candles[i].close) {
          passBar1CloseSell = false;
          if (rawSell && passWickSell && res.bar1FilteredCount !== undefined) res.bar1FilteredCount++;
        }
      }
    }

    // 3. Bar +1 Confirmation Entry Filter (optional: requires follow-through bar to confirm crossover before firing signal)
    let finalBuy = rawBuy && passWickBuy && passBar1CloseBuy;
    let finalSell = rawSell && passWickSell && passBar1CloseSell;

    if (config.filterBar1ConfirmationEntry && i >= 2) {
      const prevB1 = buffer1[i - 1];
      const prevB2 = buffer2[i - 1];
      const prev2B1 = buffer1[i - 2];
      const prev2B2 = buffer2[i - 2];
      const prevCrossBuy = !isNaN(prevB1) && !isNaN(prevB2) && !isNaN(prev2B1) && !isNaN(prev2B2) && (prevB1 > prevB2 && prev2B1 <= prev2B2);
      const prevCrossSell = !isNaN(prevB1) && !isNaN(prevB2) && !isNaN(prev2B1) && !isNaN(prev2B2) && (prevB1 < prevB2 && prev2B1 >= prev2B2);

      const c = candles[i];
      const prevC = candles[i - 1];
      // Confirm buy: crossover was on previous bar, and current bar closes green or above prev close
      const isConfirmedBuy = prevCrossBuy && (c.close >= c.open || c.close > prevC.close);
      // Confirm sell: crossover was on previous bar, and current bar closes red or below prev close
      const isConfirmedSell = prevCrossSell && (c.close <= c.open || c.close < prevC.close);

      finalBuy = isConfirmedBuy && passWickBuy && passBar1CloseBuy;
      finalSell = isConfirmedSell && passWickSell && passBar1CloseSell;
    }

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

    // Pre-market session restriction: strictly no trade before 09:15 AM IST
    let passPreMarket = true;
    if (config.noTradeBefore915 !== false) {
      const c = candles[i];
      if (c) {
        if (typeof c.time === 'number') {
          // c.time is epoch shifted by +19800 (IST offset)
          const d = new Date(c.time * 1000);
          const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
          if (mins < 9 * 60 + 15) {
            passPreMarket = false;
          }
        } else if (c.timestamp) {
          try {
            const d = new Date(c.timestamp);
            const istMins = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
            if (istMins < 9 * 60 + 15) {
              passPreMarket = false;
            }
          } catch (_) {}
        }
      }
    }

    res.callSignals[i] = finalBuy && passAdxBuy && passPreMarket && config.visibleBuy;
    res.putSignals[i] = finalSell && passAdxSell && passPreMarket && config.visibleSell;
  }

  return res;
}
