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
  }
  
  return { upper, mid, lower };
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

export function computeVWAP(candles: {high: number, low: number, close: number, volume?: number}[]): number[] {
  const vwap: number[] = new Array(candles.length).fill(NaN);
  let cumVol = 0;
  let cumVolPrice = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;
    cumVol += vol;
    cumVolPrice += typicalPrice * vol;
    vwap[i] = cumVolPrice / cumVol;
  }
  return vwap;
}

export function computeT3(series: number[], period: number = 14, hot: number = 0.7, type: 'T3 New' | 'T3 Original' = 'T3 New') {
  const lev0: number[] = new Array(series.length).fill(NaN);
  const lev1: number[] = new Array(series.length).fill(NaN);
  const lev2: number[] = new Array(series.length).fill(NaN);
  const lev3: number[] = new Array(series.length).fill(NaN);
  const lev4: number[] = new Array(series.length).fill(NaN);
  const lev5: number[] = new Array(series.length).fill(NaN);

  let alpha = 0;
  if (type === 'T3 New') {
    alpha = 2.0 / (2.0 + (period - 1.0) / 2.0);
  } else {
    alpha = 2.0 / (1.0 + period);
  }

  let prev_t30 = NaN, prev_t31 = NaN, prev_t32 = NaN, prev_t33 = NaN, prev_t34 = NaN, prev_t35 = NaN;

  for (let i = 0; i < series.length; i++) {
    const src = series[i];
    if (isNaN(src)) {
      continue;
    }
    
    // Initialize to src instead of 0 to minimize warmup lag on the 1000-candle limited dataset
    const nz30 = isNaN(prev_t30) ? src : prev_t30;
    const t30 = nz30 + alpha * (src - nz30);
    
    const nz31 = isNaN(prev_t31) ? src : prev_t31;
    const t31 = nz31 + alpha * (t30 - nz31);
    
    const nz32 = isNaN(prev_t32) ? src : prev_t32;
    const t32 = nz32 + alpha * (t31 - nz32);
    
    const nz33 = isNaN(prev_t33) ? src : prev_t33;
    const t33 = nz33 + alpha * (t32 - nz33);
    
    const nz34 = isNaN(prev_t34) ? src : prev_t34;
    const t34 = nz34 + alpha * (t33 - nz34);
    
    const nz35 = isNaN(prev_t35) ? src : prev_t35;
    const t35 = nz35 + alpha * (t34 - nz35);
    
    lev0[i] = t30;
    lev1[i] = t31;
    lev2[i] = t32;
    lev3[i] = t33;
    lev4[i] = t34;
    lev5[i] = t35;

    prev_t30 = t30;
    prev_t31 = t31;
    prev_t32 = t32;
    prev_t33 = t33;
    prev_t34 = t34;
    prev_t35 = t35;
  }

  return { lev0, lev1, lev2, lev3, lev4, lev5 };
}

export function computeMFI(high: number[], low: number[], close: number[], volume: number[], period: number = 14): number[] {
  const mfi = new Array(close.length).fill(NaN);
  const hlc3 = new Array(close.length).fill(0);
  const rawMoneyFlow = new Array(close.length).fill(0);
  
  for (let i = 0; i < close.length; i++) {
    hlc3[i] = (high[i] + low[i] + close[i]) / 3;
    rawMoneyFlow[i] = hlc3[i] * (volume[i] || 1);
  }
  
  for (let i = period; i < close.length; i++) {
    let posFlow = 0;
    let negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (hlc3[j] > hlc3[j - 1]) {
        posFlow += rawMoneyFlow[j];
      } else if (hlc3[j] < hlc3[j - 1]) {
        negFlow += rawMoneyFlow[j];
      }
    }
    if (negFlow === 0) {
      mfi[i] = 100;
    } else {
      const moneyRatio = posFlow / negFlow;
      mfi[i] = 100 - (100 / (1 + moneyRatio));
    }
  }
  return mfi;
}

export function computeAlphaTrend(
  high: number[],
  low: number[],
  close: number[],
  volume: number[],
  period: number = 14,
  coeff: number = 1.0,
  noVolumeData: boolean = false
) {
  const alphaTrend = new Array(close.length).fill(NaN);
  const buySignal = new Array(close.length).fill(false);
  const sellSignal = new Array(close.length).fill(false);
  
  const tr = new Array(close.length).fill(0);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < close.length; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }
  
  const atrSma = computeSMA(tr, period);
  const rsi = computeRSI(close, period);
  const mfi = computeMFI(high, low, close, volume, period);
  
  let prevAlphaTrend = NaN;
  
  const hasRealVolume = volume && volume.length > 0 && volume.some(v => v > 0 && v !== 1);
  const useRsiCondition = noVolumeData || !hasRealVolume;

  for (let i = 0; i < close.length; i++) {
    if (isNaN(atrSma[i])) continue;
    
    const upT = low[i] - atrSma[i] * coeff;
    const downT = high[i] + atrSma[i] * coeff;
    
    let condition = false;
    if (useRsiCondition || isNaN(mfi[i])) {
      condition = rsi[i] >= 50;
    } else {
      condition = mfi[i] >= 50;
    }
    
    const nzPrevAlphaTrend = isNaN(prevAlphaTrend) ? 0 : prevAlphaTrend;
    
    let currentAlphaTrend = 0;
    if (condition) {
      currentAlphaTrend = upT < nzPrevAlphaTrend ? nzPrevAlphaTrend : upT;
    } else {
      currentAlphaTrend = downT > nzPrevAlphaTrend ? nzPrevAlphaTrend : downT;
    }
    
    alphaTrend[i] = currentAlphaTrend;
    prevAlphaTrend = currentAlphaTrend;
  }
  
  let lastBuyIndex = -1;
  let lastSellIndex = -1;
  let direction = 0;
  
  const trigger = new Array(close.length).fill(NaN);
  
  for (let i = 2; i < close.length; i++) {
    const at = alphaTrend[i];
    const at2 = alphaTrend[i - 2];
    const prev_at = alphaTrend[i - 1];
    const prev_at2 = alphaTrend[i - 3] !== undefined ? alphaTrend[i - 3] : NaN;
    
    trigger[i] = at2;
    
    const crossover = !isNaN(at) && !isNaN(at2) && !isNaN(prev_at) && !isNaN(prev_at2) && prev_at <= prev_at2 && at > at2;
    const crossunder = !isNaN(at) && !isNaN(at2) && !isNaN(prev_at) && !isNaN(prev_at2) && prev_at >= prev_at2 && at < at2;
    
    const currentBuy = crossover;
    const currentSell = crossunder;
    
    const k1 = lastBuyIndex !== -1 ? (i - lastBuyIndex) : Infinity;
    const k2 = lastSellIndex !== -1 ? (i - lastSellIndex) : Infinity;
    
    const o1 = lastBuyIndex !== -1 ? (i - lastBuyIndex) : Infinity;
    const o2 = lastSellIndex !== -1 ? (i - lastSellIndex) : Infinity;
    
    if (currentBuy && o1 > k2) {
      direction = 1;
      buySignal[i] = true;
    } else if (currentSell && o2 > k1) {
      direction = -1;
      sellSignal[i] = true;
    }
    
    if (currentBuy) lastBuyIndex = i;
    if (currentSell) lastSellIndex = i;
  }
  
  const colors = new Array(close.length).fill('');
  for (let i = 3; i < close.length; i++) {
    const at = alphaTrend[i];
    const at1 = alphaTrend[i - 1];
    const at2 = alphaTrend[i - 2];
    const at3 = alphaTrend[i - 3];
    if (at > at2) {
      colors[i] = '#00E60F';
    } else if (at < at2) {
      colors[i] = '#80000B';
    } else if (at1 > at3) {
      colors[i] = '#00E60F';
    } else {
      colors[i] = '#80000B';
    }
  }
  
  return { alphaTrend, trigger, colors, buySignal, sellSignal };
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

