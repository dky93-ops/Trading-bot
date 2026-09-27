/**
 * ML Adaptive SuperTrend & CM MACD Implementation
 * Directly from the TradingView Pine Script specification in the PDF:
 * "NIFTY MACD + MACHINE LEARNING ADAPTIVE SUPERTREND (BEFORE & AFTER)"
 */

import { computeEMA, computeSMA, computeATR } from './technical-indicators';

export interface MLAdaptiveSTResult {
  superTrend: number[];
  direction: number[]; // -1 = Bullish (superTrend is lowerBand), 1 = Bearish (superTrend is upperBand)
  bullishShift: boolean[]; // crossunder(dir, 0): dir < 0 and prev dir >= 0
  bearishShift: boolean[]; // crossover(dir, 0): dir > 0 and prev dir <= 0
  assignedCentroid: number[];
}

/**
 * 3-cluster K-means on rolling 100-bar ATR as defined in Pine Script:
 * f_cluster(atrValue, trainingLen=100, highPct=0.75, midPct=0.50, lowPct=0.25)
 */
export function computeKMeansAdaptiveSuperTrend(
  high: number[],
  low: number[],
  close: number[],
  atrLen: number = 10,
  factor: number = 3.0,
  trainingLen: number = 100,
  highPct: number = 0.75,
  midPct: number = 0.50,
  lowPct: number = 0.25
): MLAdaptiveSTResult {
  const len = close.length;
  const atr = computeATR(high, low, close, atrLen);

  const superTrend: number[] = new Array(len).fill(NaN);
  const direction: number[] = new Array(len).fill(NaN);
  const bullishShift: boolean[] = new Array(len).fill(false);
  const bearishShift: boolean[] = new Array(len).fill(false);
  const assignedCentroidArr: number[] = new Array(len).fill(NaN);

  let prevUpperBand = NaN;
  let prevLowerBand = NaN;
  let prevSuperTrend = NaN;
  let prevDir = NaN;

  // Running centroids for K-means
  let aMean = NaN;
  let bMean = NaN;
  let cMean = NaN;

  for (let i = 0; i < len; i++) {
    const hl2 = (high[i] + low[i]) / 2;
    const atrVal = atr[i];

    if (isNaN(atrVal)) {
      continue;
    }

    // Cluster calculation on window
    let assignedCentroid = atrVal;
    if (i >= trainingLen - 1) {
      // Find highest and lowest ATR in window
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = i - trainingLen + 1; j <= i; j++) {
        const v = atr[j];
        if (!isNaN(v)) {
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
      }

      if (isNaN(aMean)) aMean = lo + (hi - lo) * highPct;
      if (isNaN(bMean)) bMean = lo + (hi - lo) * midPct;
      if (isNaN(cMean)) cMean = lo + (hi - lo) * lowPct;

      let iter = 0;
      let stable = false;
      while (!stable && iter < 100) {
        const hv: number[] = [];
        const mv: number[] = [];
        const lv: number[] = [];
        const ca = aMean;
        const cb = bMean;
        const cc = cMean;

        for (let j = i; j >= i - trainingLen + 1; j--) {
          const v = atr[j];
          if (isNaN(v)) continue;
          const dA = Math.abs(v - ca);
          const dB = Math.abs(v - cb);
          const dC = Math.abs(v - cc);

          if (dA < dB && dA < dC) hv.push(v);
          else if (dB < dA && dB < dC) mv.push(v);
          else if (dC < dA && dC < dB) lv.push(v);
        }

        const naMean = hv.length > 0 ? hv.reduce((s, x) => s + x, 0) / hv.length : ca;
        const nbMean = mv.length > 0 ? mv.reduce((s, x) => s + x, 0) / mv.length : cb;
        const ncMean = lv.length > 0 ? lv.reduce((s, x) => s + x, 0) / lv.length : cc;

        stable = (naMean === ca && nbMean === cb && ncMean === cc);
        aMean = naMean;
        bMean = nbMean;
        cMean = ncMean;
        iter++;
      }

      const d0 = Math.abs(atrVal - aMean);
      const d1 = Math.abs(atrVal - bMean);
      const d2 = Math.abs(atrVal - cMean);

      let cluster = 0;
      if (d0 <= d1 && d0 <= d2) cluster = 0;
      else if (d1 <= d0 && d1 <= d2) cluster = 1;
      else cluster = 2;

      assignedCentroid = cluster === 0 ? aMean : cluster === 1 ? bMean : cMean;
    }

    assignedCentroidArr[i] = assignedCentroid;

    // Exact AlgoAlpha-style adaptive SuperTrend computation
    let upperBand = hl2 + factor * assignedCentroid;
    let lowerBand = hl2 - factor * assignedCentroid;

    if (!isNaN(prevLowerBand)) {
      lowerBand = (lowerBand > prevLowerBand || close[i - 1] < prevLowerBand) ? lowerBand : prevLowerBand;
    }
    if (!isNaN(prevUpperBand)) {
      upperBand = (upperBand < prevUpperBand || close[i - 1] > prevUpperBand) ? upperBand : prevUpperBand;
    }

    let dir: number;
    if (isNaN(prevDir) || isNaN(prevSuperTrend)) {
      dir = 1;
    } else if (prevSuperTrend === prevUpperBand) {
      dir = close[i] > upperBand ? -1 : 1;
    } else {
      dir = close[i] < lowerBand ? 1 : -1;
    }

    const st = dir === -1 ? lowerBand : upperBand;

    superTrend[i] = st;
    direction[i] = dir;

    // Bullish shift: crossunder(dir, 0) => dir < 0 and prevDir >= 0
    if (!isNaN(prevDir)) {
      bullishShift[i] = dir < 0 && prevDir >= 0;
      bearishShift[i] = dir > 0 && prevDir <= 0;
    }

    prevLowerBand = lowerBand;
    prevUpperBand = upperBand;
    prevSuperTrend = st;
    prevDir = dir;
  }

  return {
    superTrend,
    direction,
    bullishShift,
    bearishShift,
    assignedCentroid: assignedCentroidArr
  };
}

export interface CMMACDResult {
  macdLine: number[];
  signalLine: number[];
  macdBull: boolean[];
  macdBear: boolean[];
}

/**
 * CM MACD as defined in Pine Script:
 * fastEMA = ema(close, 12)
 * slowEMA = ema(close, 26)
 * macdLine = fastEMA - slowEMA
 * signalLine = sma(macdLine, 9)
 * macdBull = macdLine > 0 and macdLine >= signalLine
 * macdBear = macdLine < 0 and macdLine < signalLine
 */
export function computeCMMACD(close: number[]): CMMACDResult {
  const fastEMA = computeEMA(close, 12);
  const slowEMA = computeEMA(close, 26);
  const len = close.length;

  const macdLine = new Array(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    if (!isNaN(fastEMA[i]) && !isNaN(slowEMA[i])) {
      macdLine[i] = fastEMA[i] - slowEMA[i];
    }
  }

  const signalLine = computeSMA(macdLine, 9);
  const macdBull = new Array(len).fill(false);
  const macdBear = new Array(len).fill(false);

  for (let i = 0; i < len; i++) {
    const ml = macdLine[i];
    const sl = signalLine[i];
    if (!isNaN(ml) && !isNaN(sl)) {
      macdBull[i] = ml > 0 && ml >= sl;
      macdBear[i] = ml < 0 && ml < sl;
    }
  }

  return { macdLine, signalLine, macdBull, macdBear };
}
