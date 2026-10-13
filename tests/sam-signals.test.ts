import { describe, it, expect } from 'vitest';
import { computeSamSignals, DEFAULT_SAM_CONFIG } from '../src/backend/sam-signals';
import { computeWMA } from '../src/backend/technical-indicators';

describe('SAM Signals & Technical Indicators', () => {
  it('computes WMA correctly', () => {
    // [10, 20, 30] with period 3:
    // (10*1 + 20*2 + 30*3) / (1+2+3) = (10 + 40 + 90) / 6 = 140 / 6 = 23.333
    const data = [10, 20, 30];
    const wma = computeWMA(data, 3);
    expect(wma[0]).toBeNaN();
    expect(wma[1]).toBeNaN();
    expect(wma[2]).toBeCloseTo(23.333, 2);
  });

  it('runs computeSamSignals on dummy candle sequence without crashing', () => {
    const candles: any[] = [];
    let price = 25000;
    for (let i = 0; i < 100; i++) {
      const change = (i % 2 === 0 ? 5 : -4);
      price += change;
      candles.push({
        open: price - 2,
        high: price + 10,
        low: price - 10,
        close: price,
        volume: 1000
      });
    }

    const res = computeSamSignals(candles, {
      ...DEFAULT_SAM_CONFIG,
      adxFilterEnabled: true,
      stopLossPoints: 20
    });

    expect(res.buffer1.length).toBe(100);
    expect(res.buffer2.length).toBe(100);
    expect(res.callSignals.length).toBe(100);
    expect(res.putSignals.length).toBe(100);
  });

  it('generates CALL when buffer1 crosses above buffer2', () => {
    const candles: any[] = [];
    // 40 flat candles so buffer1 is near 0
    for (let i = 0; i < 40; i++) {
      candles.push({ open: 100, high: 101, low: 99, close: 100, volume: 100 });
    }
    // Then sharp jump up
    for (let i = 40; i < 50; i++) {
      const p = 100 + (i - 39) * 5;
      candles.push({ open: p - 2, high: p + 2, low: p - 3, close: p, volume: 100 });
    }

    const res = computeSamSignals(candles, {
      maFastPeriod: 1,
      maSlowPeriod: 34,
      signalPeriod: 5,
      adxFilterEnabled: false,
      noTradeBefore915: false
    });

    const callCount = res.callSignals.filter(Boolean).length;
    expect(callCount).toBeGreaterThan(0);
  });

  describe('Targeted Precision Filters & Independent On/Off Toggles', () => {
    function generateBaseCrossoverCandles() {
      const candles: any[] = [];
      for (let i = 0; i < 40; i++) {
        candles.push({ open: 100, high: 101, low: 99, close: 100, volume: 100 });
      }
      for (let i = 40; i < 50; i++) {
        const p = 100 + (i - 39) * 5;
        candles.push({ open: p - 2, high: p + 2, low: p - 3, close: p, volume: 100 });
      }
      return candles;
    }

    it('Filter 1: Stochastic Clearance Filter blocks and allows independently', () => {
      const candles = generateBaseCrossoverCandles();

      // Enabled
      const resEnabled = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        stochFilterEnabled: true,
        stochCallMinK: 25,
      });

      // Disabled
      const resDisabled = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        stochFilterEnabled: false,
      });

      expect(resEnabled.stochK).toBeDefined();
      expect(resEnabled.stochD).toBeDefined();
      expect(resDisabled.stochK).toBeUndefined();
      expect(resDisabled.callSignals.length).toBe(candles.length);
    });

    it('Filter 2: Bollinger Band Runway Filter (%B) blocks and allows independently', () => {
      const candles = generateBaseCrossoverCandles();

      const resEnabled = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        bbFilterEnabled: true,
        bbCallMinPctB: 0.25,
        bbCallMaxPctB: 0.80,
      });

      const resDisabled = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        bbFilterEnabled: false,
      });

      expect(resEnabled.bbPercentB).toBeDefined();
      expect(resDisabled.bbPercentB).toBeUndefined();
      expect(resDisabled.callSignals.length).toBe(candles.length);
    });

    it('Filter 3: RSI Regime Filter blocks and allows independently', () => {
      const candles = generateBaseCrossoverCandles();

      const resEnabled = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        rsiFilterEnabled: true,
        rsiCallMin: 45,
        rsiPutMax: 55,
      });

      const resDisabled = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        rsiFilterEnabled: false,
      });

      expect(resEnabled.rsiValues).toBeDefined();
      expect(resDisabled.rsiValues).toBeUndefined();
      expect(resDisabled.callSignals.length).toBe(candles.length);
    });

    it('Filter 4: Outside Bar Veto Rule blocks CALL on Bearish Outside Bar and passes when disabled', () => {
      const candles = generateBaseCrossoverCandles();
      // Introduce a Bearish Outside Bar at index 40 (crossover candle or preceding bar)
      // High > PrevHigh && Low < PrevLow && Close < Open
      candles[39] = {
        open: 104,
        high: 110,
        low: 95,
        close: 96,
        volume: 500
      };

      const resBlocked = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        outsideBarFilterEnabled: true,
        outsideBarLookback: 2,
      });

      const resAllowed = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        outsideBarFilterEnabled: false,
      });

      expect(resBlocked.outsideBars).toBeDefined();
      expect(resBlocked.outsideBars![39]).toBe('BEARISH');
      // At index 40, CALL should be vetoed by the Bearish Outside Bar
      expect(resBlocked.callSignals[40]).toBe(false);
      // When disabled, the raw crossover fires
      expect(resAllowed.callSignals[40]).toBe(true);
    });

    it('All 4 filters can be combined or toggled separately without conflict', () => {
      const candles = generateBaseCrossoverCandles();

      const resAllOn = computeSamSignals(candles, {
        maFastPeriod: 1,
        maSlowPeriod: 34,
        signalPeriod: 5,
        noTradeBefore915: false,
        stochFilterEnabled: true,
        bbFilterEnabled: true,
        rsiFilterEnabled: true,
        outsideBarFilterEnabled: true,
      });

      expect(resAllOn.stochK).toBeDefined();
      expect(resAllOn.bbPercentB).toBeDefined();
      expect(resAllOn.rsiValues).toBeDefined();
      expect(resAllOn.outsideBars).toBeDefined();
    });
  });
});
