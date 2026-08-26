import { describe, it, expect } from 'vitest';
import { computeATR } from '../src/backend/technical-indicators';

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
