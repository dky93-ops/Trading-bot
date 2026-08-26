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
