export function computeEMA(series: number[], period: number): number[] {
  const result: number[] = new Array(series.length).fill(NaN);
  if (series.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += series[i];
  let ema = sum / period;
  result[period - 1] = ema;
  const k = 2 / (period + 1);
  for (let i = period; i < series.length; i++) {
    ema = (series[i] - ema) * k + ema;
    result[i] = ema;
  }
  return result;
}

export function computeSMA(series: number[], period: number): number[] {
  const result: number[] = new Array(series.length).fill(NaN);
  if (series.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += series[i];
  result[period - 1] = sum / period;
  for (let i = period; i < series.length; i++) {
    sum += series[i] - series[i - period];
    result[i] = sum / period;
  }
  return result;
}

export function computeRSI(series: number[], period: number = 14): number[] {
  const result: number[] = new Array(series.length).fill(NaN);
  if (series.length <= period) return result;
  
  let avgGain = 0;
  let avgLoss = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = series[i] - series[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  
  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[period] = 100 - (100 / (1 + rs));
  }
  
  for (let i = period + 1; i < series.length; i++) {
    const diff = series[i] - series[i - 1];
    let gain = 0, loss = 0;
    if (diff > 0) gain = diff;
    else loss = -diff;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - (100 / (1 + rs));
    }
  }
  return result;
}

export function computeMACD(series: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = computeEMA(series, fast);
  const emaSlow = computeEMA(series, slow);
  const macdLine = new Array(series.length).fill(NaN);
  for (let i = 0; i < series.length; i++) {
    if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }
  
  // To compute signal line, we need to apply EMA to the MACD line
  // We extract the valid MACD values to compute EMA
  const validMacdStartIndex = macdLine.findIndex(val => !isNaN(val));
  const signalLine = new Array(series.length).fill(NaN);
  const histogram = new Array(series.length).fill(NaN);

  if (validMacdStartIndex !== -1) {
    const validMacd = macdLine.slice(validMacdStartIndex);
    const emaMacd = computeEMA(validMacd, signal);
    for (let i = 0; i < emaMacd.length; i++) {
      signalLine[validMacdStartIndex + i] = emaMacd[i];
      if (!isNaN(macdLine[validMacdStartIndex + i]) && !isNaN(emaMacd[i])) {
        histogram[validMacdStartIndex + i] = macdLine[validMacdStartIndex + i] - emaMacd[i];
      }
    }
  }
  
  return { macdLine, signalLine, histogram };
}

export function computeBollinger(series: number[], period = 20, stdMult = 2.0) {
  const mid = computeSMA(series, period);
  const upper = new Array(series.length).fill(NaN);
  const lower = new Array(series.length).fill(NaN);
  const percentB = new Array(series.length).fill(NaN);
  
  for (let i = period - 1; i < series.length; i++) {
    const slice = series.slice(i - period + 1, i + 1);
    const mean = mid[i];
    let sumSq = 0;
    for (const val of slice) {
      sumSq += (val - mean) ** 2;
    }
    const std = Math.sqrt(sumSq / period);
    upper[i] = mean + stdMult * std;
    lower[i] = mean - stdMult * std;
    const diff = upper[i] - lower[i];
    percentB[i] = diff > 0 ? (series[i] - lower[i]) / diff : 0.5;
  }
  
  return { upper, mid, lower, percentB };
}

export function computeATR(high: number[], low: number[], close: number[], period = 14) {
  const result: number[] = new Array(high.length).fill(NaN);
  const tr: number[] = new Array(high.length).fill(NaN);
  
  tr[0] = high[0] - low[0];
  for (let i = 1; i < high.length; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }
  
  if (tr.length < period) return result;
  
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let atr = sum / period;
  result[period - 1] = atr;
  
  const k = 1 / period; // Wilder's Smoothing / RMA is basically EMA with alpha=1/period, but standard is alpha=2/(n+1). Wait, Python used `ewm(com=period - 1)` which means alpha = 1 / (com + 1) = 1 / period.
  
  for (let i = period; i < tr.length; i++) {
    atr = (tr[i] - atr) * k + atr;
    result[i] = atr;
  }
  
  return result;
}

export function computeSuperTrend(high: number[], low: number[], close: number[], period = 10, multiplier = 3.0) {
  const atr = computeATR(high, low, close, period);
  const stLine = new Array(high.length).fill(NaN);
  const direction = new Array(high.length).fill(1);
  
  const upperBasic = new Array(high.length).fill(NaN);
  const lowerBasic = new Array(high.length).fill(NaN);
  const upperBand = new Array(high.length).fill(NaN);
  const lowerBand = new Array(high.length).fill(NaN);
  
  for(let i=0; i<high.length; i++) {
    const hl2 = (high[i] + low[i]) / 2;
    if(!isNaN(atr[i])) {
      upperBasic[i] = hl2 + multiplier * atr[i];
      lowerBasic[i] = hl2 - multiplier * atr[i];
    }
  }
  
  for(let i=1; i<high.length; i++) {
    if(isNaN(upperBasic[i])) continue;
    
    // Upper band
    if(upperBasic[i] < upperBand[i-1] || close[i-1] > upperBand[i-1] || isNaN(upperBand[i-1])) {
      upperBand[i] = upperBasic[i];
    } else {
      upperBand[i] = upperBand[i-1];
    }
    
    // Lower band
    if(lowerBasic[i] > lowerBand[i-1] || close[i-1] < lowerBand[i-1] || isNaN(lowerBand[i-1])) {
      lowerBand[i] = lowerBasic[i];
    } else {
      lowerBand[i] = lowerBand[i-1];
    }
    
    // Direction
    const prevSt = stLine[i-1];
    if(isNaN(prevSt) || prevSt === upperBand[i-1]) {
      if(close[i] <= upperBand[i]) {
        stLine[i] = upperBand[i];
        direction[i] = -1;
      } else {
        stLine[i] = lowerBand[i];
        direction[i] = 1;
      }
    } else {
      if(close[i] >= lowerBand[i]) {
        stLine[i] = lowerBand[i];
        direction[i] = 1;
      } else {
        stLine[i] = upperBand[i];
        direction[i] = -1;
      }
    }
  }
  
  return { stLine, direction };
}

export function computeVWAP(candles: Array<{high: number, low: number, close: number, volume?: number, time?: any, timestamp?: any}>): number[] {
  const vwap: number[] = new Array(candles.length).fill(NaN);
  let cumVol = 0;
  let cumVolPrice = 0;
  let lastDay: number | string = -1;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.time !== undefined || c.timestamp !== undefined) {
      let dayKey: number | string = -1;
      if (typeof c.time === 'number') {
        // c.time in lightweight-charts is epoch seconds (which includes +19800 for IST)
        dayKey = Math.floor(c.time / 86400);
      } else if (c.timestamp) {
        try {
          const d = new Date(c.timestamp);
          // Convert UTC timestamp to IST (+5:30) epoch ms for rock-solid session day boundary
          const istEpochMs = d.getTime() + 19800000;
          dayKey = Math.floor(istEpochMs / 86400000);
        } catch (_) {
          dayKey = typeof c.timestamp === 'string' ? c.timestamp.split('T')[0] : new Date(c.timestamp).getUTCDate();
        }
      }
      if (dayKey !== -1 && dayKey !== lastDay) {
        cumVol = 0;
        cumVolPrice = 0;
        lastDay = dayKey;
      }
    }

    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume && c.volume > 0 ? c.volume : 1;
    cumVol += vol;
    cumVolPrice += typicalPrice * vol;
    vwap[i] = cumVol > 0 ? Number((cumVolPrice / cumVol).toFixed(2)) : typicalPrice;
  }
  return vwap;
}



export function computeADX(
  high: number[],
  low: number[],
  close: number[],
  period: number = 14
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const len = close.length;
  const adx = new Array(len).fill(NaN);
  const plusDI = new Array(len).fill(NaN);
  const minusDI = new Array(len).fill(NaN);

  if (len < period + 1) return { adx, plusDI, minusDI };

  const tr: number[] = new Array(len).fill(0);
  const plusDM: number[] = new Array(len).fill(0);
  const minusDM: number[] = new Array(len).fill(0);

  tr[0] = high[0] - low[0];
  for (let i = 1; i < len; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);

    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];

    if (up > down && up > 0) {
      plusDM[i] = up;
    } else {
      plusDM[i] = 0;
    }

    if (down > up && down > 0) {
      minusDM[i] = down;
    } else {
      minusDM[i] = 0;
    }
  }

  // Wilder's smoothing (RMA)
  let smoothTR = 0;
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;

  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i];
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
  }

  const dx: number[] = new Array(len).fill(NaN);

  const calcDI = (pDM: number, mDM: number, sTR: number) => {
    const pDI = sTR === 0 ? 0 : (pDM / sTR) * 100;
    const mDI = sTR === 0 ? 0 : (mDM / sTR) * 100;
    const diDiff = Math.abs(pDI - mDI);
    const diSum = pDI + mDI;
    const currDX = diSum === 0 ? 0 : (diDiff / diSum) * 100;
    return { pDI, mDI, currDX };
  };

  const initial = calcDI(smoothPlusDM, smoothMinusDM, smoothTR);
  plusDI[period] = initial.pDI;
  minusDI[period] = initial.mDI;
  dx[period] = initial.currDX;

  for (let i = period + 1; i < len; i++) {
    smoothTR = smoothTR - (smoothTR / period) + tr[i];
    smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
    smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];

    const diRes = calcDI(smoothPlusDM, smoothMinusDM, smoothTR);
    plusDI[i] = diRes.pDI;
    minusDI[i] = diRes.mDI;
    dx[i] = diRes.currDX;
  }

  // Smooth DX to get ADX
  const adxStart = period * 2 - 1;
  if (len > adxStart) {
    let sumDX = 0;
    for (let i = period; i <= adxStart; i++) {
      sumDX += dx[i];
    }
    let currADX = sumDX / period;
    adx[adxStart] = currADX;

    for (let i = adxStart + 1; i < len; i++) {
      currADX = (currADX * (period - 1) + dx[i]) / period;
      adx[i] = currADX;
    }
  }

  return { adx, plusDI, minusDI };
}

export function computeWMA(series: number[], period: number): number[] {
  const len = series.length;
  const result: number[] = new Array(len).fill(NaN);
  if (period <= 0 || len < period) return result;
  if (period === 1) return [...series];

  const weightSum = (period * (period + 1)) / 2;

  for (let i = period - 1; i < len; i++) {
    let sum = 0;
    let valid = true;
    for (let w = 1; w <= period; w++) {
      const val = series[i - period + w];
      if (val === undefined || isNaN(val)) {
        valid = false;
        break;
      }
      sum += val * w;
    }
    if (valid) {
      result[i] = sum / weightSum;
    }
  }
  return result;
}

export function computeStochastic(
  high: number[],
  low: number[],
  close: number[],
  kPeriod = 14,
  dPeriod = 3,
  smoothK = 3
): { K: number[]; D: number[] } {
  const len = close.length;
  const rawK = new Array(len).fill(NaN);
  for (let i = kPeriod - 1; i < len; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = 0; j < kPeriod; j++) {
      if (high[i - j] > highest) highest = high[i - j];
      if (low[i - j] < lowest) lowest = low[i - j];
    }
    const range = highest - lowest;
    rawK[i] = range === 0 ? 50 : ((close[i] - lowest) / range) * 100;
  }

  // Smooth rawK with SMA(smoothK) to get %K
  const K = new Array(len).fill(NaN);
  for (let i = kPeriod - 1 + smoothK - 1; i < len; i++) {
    let sum = 0;
    for (let j = 0; j < smoothK; j++) sum += rawK[i - j];
    K[i] = sum / smoothK;
  }

  // %D is SMA of %K over dPeriod
  const D = new Array(len).fill(NaN);
  for (let i = kPeriod - 1 + smoothK - 1 + dPeriod - 1; i < len; i++) {
    let sum = 0;
    for (let j = 0; j < dPeriod; j++) sum += K[i - j];
    D[i] = sum / dPeriod;
  }

  return { K, D };
}

export type OutsideBarType = 'BULLISH' | 'BEARISH' | 'NONE';

export function computeOutsideBars(
  candles: Array<{ high: number; low: number; open: number; close: number }>
): OutsideBarType[] {
  const len = candles.length;
  const result: OutsideBarType[] = new Array(len).fill('NONE');
  for (let i = 1; i < len; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    // Outside Bar condition: High > PrevHigh && Low < PrevLow
    if (curr.high > prev.high && curr.low < prev.low) {
      if (curr.close > curr.open) {
        result[i] = 'BULLISH';
      } else if (curr.close < curr.open) {
        result[i] = 'BEARISH';
      } else {
        result[i] = 'NONE';
      }
    }
  }
  return result;
}

export interface MtfEmaResult {
  ema: number[];
  slope: number[];
}

/**
 * Computes 5-Minute Multi-Timeframe (MTF) EMA on 1-minute candle data.
 * Aggregates 1-minute bars into 5-minute sessions, calculates EMA, and maps back.
 */
export function compute5MinEMA(
  candles: Array<{ high: number; low: number; open: number; close: number; time?: any; timestamp?: any }>,
  period: number = 20
): MtfEmaResult {
  const len = candles.length;
  const ema = new Array(len).fill(NaN);
  const slope = new Array(len).fill(0);
  if (len === 0) return { ema, slope };

  // Strictly causal (zero-lookahead) 5-min EMA:
  // At any 1-min candle i, ONLY candles[0..i] are used.
  // Previous completed 5-min buckets lock in `lastCompletedEma`; intra-bar candles
  // update live against `lastCompletedEma` using only candle i's own close.
  const k = 2 / (period + 1);
  let lastBucketKey: number | string | null = null;
  let lastCompletedEma = NaN;
  let lastBucketClose = NaN;

  for (let i = 0; i < len; i++) {
    const c = candles[i];
    let bucketKey: number | string = Math.floor(i / 5);
    if (typeof c.time === 'number') {
      bucketKey = Math.floor(c.time / 300) * 300;
    } else if (c.timestamp) {
      try {
        const d = new Date(c.timestamp);
        const ms = d.getTime() + 19800000;
        bucketKey = Math.floor(ms / 300000) * 300000;
      } catch (_) {}
    }

    if (lastBucketKey !== null && bucketKey !== lastBucketKey) {
      // Previous 5-min bucket just closed at i - 1; commit its closing EMA
      lastCompletedEma = isNaN(lastCompletedEma)
        ? lastBucketClose
        : (lastBucketClose - lastCompletedEma) * k + lastCompletedEma;
    }

    lastBucketKey = bucketKey;
    lastBucketClose = c.close;

    const curLiveEma = isNaN(lastCompletedEma)
      ? c.close
      : (c.close - lastCompletedEma) * k + lastCompletedEma;
    const curLiveSlope = isNaN(lastCompletedEma)
      ? 0
      : curLiveEma - lastCompletedEma;

    ema[i] = Number(curLiveEma.toFixed(2));
    slope[i] = Number(curLiveSlope.toFixed(2));
  }

  return { ema, slope };
}


