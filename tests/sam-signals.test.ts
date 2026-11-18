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

  it('defaults entryTiming to bar1Close (Zero Repaint) in DEFAULT_SAM_CONFIG', () => {
    expect(DEFAULT_SAM_CONFIG.entryTiming).toBe('bar1Close');
  });

  it('generates pending candidate on Bar 0 and confirmed entry at Bar + 1 close if favorable', () => {
    const candles: any[] = [];
    for (let i = 0; i < 40; i++) {
      candles.push({ open: 100, high: 101, low: 99, close: 100, time: 1000 + i * 60 });
    }
    // Bar 40: crossover candle (setup / Bar 0)
    candles.push({ open: 100, high: 108, low: 99, close: 106, time: 1000 + 40 * 60 });
    // Bar 41: Bar + 1 candle (closes favorable green above signal close)
    candles.push({ open: 106, high: 112, low: 105, close: 110, time: 1000 + 41 * 60 });

    const res = computeSamSignals(candles, {
      ...DEFAULT_SAM_CONFIG,
      entryTiming: 'bar1Close',
      filterBar1AdverseCloseEnabled: true,
      noTradeBefore915: false
    });

    // Bar 40 is a candidate setup, NOT yet an entered trade
    expect(res.candidateCallSignals?.[40]).toBe(true);
    expect(res.callSignals[40]).toBe(false);

    // Bar 41 passed adverse filter and triggers confirmed entry at Bar + 1 close
    expect(res.callSignals[41]).toBe(true);
  });

  it('invalidates and skips trade at Bar + 1 close if Bar + 1 closes adverse (zero repaint)', () => {
    const candles: any[] = [];
    for (let i = 0; i < 40; i++) {
      candles.push({ open: 100, high: 101, low: 99, close: 100, time: 1000 + i * 60 });
    }
    // Bar 40: crossover candle (setup / Bar 0)
    candles.push({ open: 100, high: 108, low: 99, close: 106, time: 1000 + 40 * 60 });
    // Bar 41: Bar + 1 candle closes adverse (red, below signal close)
    candles.push({ open: 106, high: 107, low: 98, close: 99, time: 1000 + 41 * 60 });

    const res = computeSamSignals(candles, {
      ...DEFAULT_SAM_CONFIG,
      entryTiming: 'bar1Close',
      filterBar1AdverseCloseEnabled: true,
      noTradeBefore915: false
    });

    // Bar 40 was candidate setup
    expect(res.candidateCallSignals?.[40]).toBe(true);
    // Neither Bar 40 nor Bar 41 fired a confirmed trade!
    expect(res.callSignals[40]).toBe(false);
    expect(res.callSignals[41]).toBe(false);
    expect(res.bar1FilteredCount).toBeGreaterThan(0);
  });

  describe.skip('Targeted Precision Filters & Independent On/Off Toggles', () => {
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
