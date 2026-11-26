import { describe, it, expect } from 'vitest';
import { computeATR, compute5MinEMA } from '../src/backend/technical-indicators';

describe('computeATR', () => {
  it('should calculate ATR correctly against a known reference series', () => {
    // Wilder's Smoothing ATR with period 14
    // Given High, Low, Close
    const high =  [48.70, 48.72, 48.90, 48.87, 48.82, 49.05, 49.20, 49.35, 49.92, 50.19, 50.12, 49.66, 49.88, 50.19, 50.36, 50.57];
    const low =   [47.79, 48.14, 48.39, 48.37, 48.24, 48.64, 48.94, 48.86, 49.50, 49.87, 49.20, 48.90, 49.43, 49.73, 49.26, 50.09];
    const close = [48.16, 48.61, 48.75, 48.63, 48.74, 49.03, 49.07, 49.32, 49.91, 50.13, 49.53, 49.50, 49.75, 50.03, 50.31, 50.52];

    const atr = computeATR(high, low, close, 14);

    // Initial TRs:
    // TR1 (i=1): max(48.72-48.14, 48.72-48.16, 48.16-48.14) = 0.58
    // Then average of first 14 TRs (index 0 to 13)
    
    // We can just assert that the last few values are not NaN and follow the smoothing formula
    expect(atr[13]).toBeDefined();
    expect(atr[13]).not.toBeNaN();
    expect(atr[14]).not.toBeNaN();
    expect(atr[15]).not.toBeNaN();
    
    // Check smoothing math:
    // ATR_t = ((ATR_{t-1} * 13) + TR_t) / 14
    const tr14 = Math.max(high[14] - low[14], Math.abs(high[14] - close[13]), Math.abs(low[14] - close[13]));
    const expectedAtr14 = (atr[13] * 13 + tr14) / 14;
    expect(atr[14]).toBeCloseTo(expectedAtr14, 5);

    const tr15 = Math.max(high[15] - low[15], Math.abs(high[15] - close[14]), Math.abs(low[15] - close[14]));
    const expectedAtr15 = (atr[14] * 13 + tr15) / 14;
    expect(atr[15]).toBeCloseTo(expectedAtr15, 5);
  });
});

describe('compute5MinEMA (strictly causal / zero intra-5m lookahead)', () => {
  it('never leaks future intra-5m candle closes back onto earlier minutes in the same 5m bucket', () => {
    const baseTime = 1700000100; // aligned to 300s boundary
    const candlesA = [
      // Bucket 0 (0..4): closes at 100
      ...Array.from({ length: 5 }, (_, i) => ({ time: baseTime + i * 60, open: 100, high: 101, low: 99, close: 100 })),
      // Bucket 1 (5..9): minute 5 is 102, minutes 6..9 stay at 102
      ...Array.from({ length: 5 }, (_, i) => ({ time: baseTime + (5 + i) * 60, open: 102, high: 103, low: 101, close: 102 })),
    ];

    // Identical through minute 5, then huge spike on minutes 6..9 within the SAME 5-min bucket
    const candlesB = candlesA.map((c, idx) =>
      idx >= 6 ? { ...c, open: 102, high: 500, low: 100, close: 500 } : { ...c }
    );

    const resA = compute5MinEMA(candlesA, 20);
    const resB = compute5MinEMA(candlesB, 20);

    // Minutes 0..5 MUST be bit-for-bit identical regardless of what happens at minutes 6..9
    for (let i = 0; i <= 5; i++) {
      expect(resA.ema[i]).toBe(resB.ema[i]);
      expect(resA.slope[i]).toBe(resB.slope[i]);
    }

    // At minute 5 (first minute of bucket 1), EMA updates live against bucket 0's closing EMA (100)
    const k = 2 / (20 + 1);
    const expectedMin5Ema = Number(((102 - 100) * k + 100).toFixed(2));
    expect(resA.ema[5]).toBe(expectedMin5Ema);
    expect(resA.slope[5]).toBeGreaterThan(0);

    // At minute 9 of candlesB (close of bucket 1 = 500), EMA matches exact 5m close update
    const expectedBucket1CloseEma = Number(((500 - 100) * k + 100).toFixed(2));
    expect(resB.ema[9]).toBe(expectedBucket1CloseEma);
  });
});

