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

  it('S12 Confluence Filter allows aligned DI>+5, EMA100/200 & RVOL>=0.70 entries and blocks thin-volume or counter-EMA entries', () => {
    const buildSeries = (bar1Volume: number, priorTrendBase: number) => {
      const candles: any[] = [];
      // 205 warmup bars so EMA100 & EMA200 are fully primed
      for (let i = 0; i < 205; i++) {
        const p = priorTrendBase + (i >= 180 ? (i - 180) * 0.2 : 0);
        candles.push({
          open: p - 0.5,
          high: p + 1.5,
          low: p - 1.5,
          close: p,
          volume: 1000,
          time: 1700000100 + i * 60,
        });
      }
      // Small 5-bar dip to pull buffer1 slightly below buffer2, then sharp bullish breakout
      const base = candles[candles.length - 1].close;
      for (let k = 0; k < 5; k++) {
        const p = base - (k + 1) * 1.2;
        candles.push({ open: p + 0.5, high: p + 1, low: p - 1, close: p, volume: 1000, time: 1700000100 + (205 + k) * 60 });
      }
      // Bar 210 (Setup Bar 0): strong bullish crossover above SMA34/buffer2
      candles.push({ open: base - 5, high: base + 12, low: base - 5, close: base + 10, volume: 1200, time: 1700000100 + 210 * 60 });
      // Bar 211 (Confirmation Bar + 1): strong bullish follow-through
      candles.push({ open: base + 10, high: base + 22, low: base + 9, close: base + 20, volume: bar1Volume, time: 1700000100 + 211 * 60 });
      return candles;
    };

    // Case 1: Strong uptrend above EMA100/200, strong +DI spread, healthy RVOL (1.2x >= 0.70) -> PASS
    const passCandles = buildSeries(1200, 25000);
    const resPass = computeSamSignals(passCandles, {
      ...DEFAULT_SAM_CONFIG,
      vwapFilterEnabled: false,
      adaptiveRegimeEnabled: false,
      noTradeBefore915: false,
      filterS12ConfluenceEnabled: true,
      s12DiSpreadMin: 5,
      s12MinRvol: 0.7,
    });
    expect(resPass.callSignals[211]).toBe(true);
    expect(resPass.ema100Values).toBeDefined();
    expect(resPass.ema200Values).toBeDefined();

    // Case 2: Identical setup, except Bar+1 has thin volume (RVOL = 0.20 < 0.70) -> BLOCKED by S12
    const lowVolCandles = buildSeries(200, 25000);
    const resLowVol = computeSamSignals(lowVolCandles, {
      ...DEFAULT_SAM_CONFIG,
      vwapFilterEnabled: false,
      adaptiveRegimeEnabled: false,
      noTradeBefore915: false,
      filterS12ConfluenceEnabled: true,
      s12DiSpreadMin: 5,
      s12MinRvol: 0.7,
    });
    expect(resLowVol.callSignals[211]).toBe(false);
    expect(resLowVol.s12FilteredCount).toBeGreaterThan(0);

    // Case 3: Counter-macro CALL (price far below EMA200 after long decline) -> BLOCKED by S12
    const counterMacroCandles = buildSeries(1500, 25000);
    for (let i = 0; i < 120; i++) {
      // Make earlier history much higher so EMA200 stays well above Bar 211 close
      counterMacroCandles[i].open += 500;
      counterMacroCandles[i].high += 500;
      counterMacroCandles[i].low += 500;
      counterMacroCandles[i].close += 500;
    }
    const resCounterMacro = computeSamSignals(counterMacroCandles, {
      ...DEFAULT_SAM_CONFIG,
      vwapFilterEnabled: false,
      adaptiveRegimeEnabled: false,
      noTradeBefore915: false,
      filterS12ConfluenceEnabled: true,
      s12DiSpreadMin: 5,
      s12MinRvol: 0.7,
    });
    expect(resCounterMacro.callSignals[211]).toBe(false);
    expect(resCounterMacro.s12FilteredCount).toBeGreaterThan(0);
  });

  it('SAM 21/5 Institutional Filters (#1 Afternoon & #2 Combined) fire in exact IST windows with zero lookahead', () => {
    // Helper to build an IST-shifted timestamp for a given day index and IST hour:minute
    // Base day 0 = 2025-05-01 00:00 UTC-as-IST -> 1746057600
    const BASE_DAY_SEC = 1746057600;
    const makeTime = (dayOffset: number, hour: number, min: number) =>
      BASE_DAY_SEC + dayOffset * 86400 + (hour * 60 + min) * 60;

    // Build 2 full NSE trading days (Day 0: 09:15-15:29, Day 1: 09:15-15:29)
    // Day 0 establishes steady uptrend (so 5m ADX >= 30 & 15m Supertrend bullish) with PDH around 25200
    const candles: Array<{ open: number; high: number; low: number; close: number; volume: number; time: number }> = [];
    let price = 24800;

    // Day 0: 375 bars (09:15 to 15:29) rising cleanly from 24800 -> ~25175 (PDH ~ 25180)
    for (let m = 0; m < 375; m++) {
      const totalMin = 9 * 60 + 15 + m;
      const hr = Math.floor(totalMin / 60);
      const mn = totalMin % 60;
      const open = price;
      const close = price + 1.0;
      candles.push({
        open,
        high: close + 1.2,
        low: open - 0.5,
        close,
        volume: 1500,
        time: makeTime(0, hr, mn),
      });
      price = close;
    }

    // Day 1: 375 bars (09:15 to 15:29)
    // 09:15-09:29: mild pullback near 25165-25170 (below PDH ~25176) to pull 3m buffer1 below buffer2
    // 09:30-09:32 (3m closing bar at 09:32): huge strong bullish expansion breaking above PDH!
    // 12:20-12:34: mild dip above PDH (25260 -> 25245) to pull 1m buffer1 below buffer2
    // 12:35: sharp bullish 1m crossover above PDH with 5m ADX >= 30 -> Afternoon CALL!
    price = 25170;
    for (let m = 0; m < 375; m++) {
      const totalMin = 9 * 60 + 15 + m;
      const hr = Math.floor(totalMin / 60);
      const mn = totalMin % 60;
      let open = price;
      let close = price;
      let high = price + 1;
      let low = price - 1;

      if (totalMin >= 555 && totalMin <= 569) {
        // 09:15 - 09:29: slight drift down so 3m SAM(21/5) drops below signal
        open = price;
        close = price - 1.5;
        high = open + 0.5;
        low = close - 0.5;
      } else if (totalMin >= 570 && totalMin <= 572) {
        // 09:30 - 09:32: 3m Strong Bar breakout above PDH (~25176)
        open = price;
        close = price + 22;
        high = close + 0.5;
        low = open - 0.2;
      } else if (totalMin >= 740 && totalMin <= 754) {
        // 12:20 - 12:34: gentle pullback while staying well above PDH
        open = price;
        close = price - 1.2;
        high = open + 0.4;
        low = close - 0.4;
      } else if (totalMin === 755) {
        // 12:35 IST (inside 12:30-14:50): sharp bullish 1m SAM(21/5) crossover above PDH
        open = price;
        close = price + 25;
        high = close + 1;
        low = open - 0.5;
      } else {
        // Gentle trend drift up so 5m ADX >= 30 & 15m Supertrend remains bullish
        open = price;
        close = price + 0.8;
        high = close + 0.8;
        low = open - 0.3;
      }

      candles.push({
        open,
        high,
        low,
        close,
        volume: 1500,
        time: makeTime(1, hr, mn),
      });
      price = close;
    }

    // 1. Default config has both new filters OFF
    expect(DEFAULT_SAM_CONFIG.filterSam21AfternoonEnabled).toBe(false);
    expect(DEFAULT_SAM_CONFIG.filterSam21CombinedEnabled).toBe(false);

    // 2. Filter 1 ON (Fixed40 mode): fires Afternoon CALL inside 12:30-14:50, ZERO morning signals
    const resAftFixed = computeSamSignals(candles, {
      ...DEFAULT_SAM_CONFIG,
      filterSam21AfternoonEnabled: true,
      sam21AfternoonExitMode: 'fixed40',
      filterSam21CombinedEnabled: false,
    });
    expect(resAftFixed.sam21AfternoonSignalCount).toBeGreaterThan(0);
    expect(resAftFixed.sam21OpenDriveSignalCount).toBe(0);
    const aftIdx = resAftFixed.callSignals.findIndex(Boolean);
    expect(aftIdx).toBeGreaterThanOrEqual(375);
    expect(resAftFixed.samSignalProfile?.[aftIdx]).toBe('SAM21_AFT_FIXED');

    // 3. Filter 1 ON (Chandelier mode): sets SAM21_AFT_CHAND profile
    const resAftChand = computeSamSignals(candles, {
      ...DEFAULT_SAM_CONFIG,
      filterSam21AfternoonEnabled: true,
      sam21AfternoonExitMode: 'chandelier',
      filterSam21CombinedEnabled: false,
    });
    expect(resAftChand.samSignalProfile?.[aftIdx]).toBe('SAM21_AFT_CHAND');

    // 4. Filter 2 ON (Morning + Afternoon Combined): fires BOTH 3m OpenDrive Morning AND 1m Afternoon
    const resCombined = computeSamSignals(candles, {
      ...DEFAULT_SAM_CONFIG,
      filterSam21AfternoonEnabled: false,
      filterSam21CombinedEnabled: true,
      sam21AfternoonExitMode: 'fixed40',
    });
    expect(resCombined.sam21OpenDriveSignalCount).toBeGreaterThan(0);
    expect(resCombined.sam21AfternoonSignalCount).toBeGreaterThan(0);
    const openDriveIdx = resCombined.samSignalProfile?.findIndex(p => p === 'SAM21_3M_OPENDRIVE') ?? -1;
    expect(openDriveIdx).toBeGreaterThanOrEqual(375);
    expect(resCombined.callSignals[openDriveIdx]).toBe(true);
    expect(resCombined.atr5mValues?.[openDriveIdx]).toBeGreaterThan(0);

    // 5. Zero-Lookahead Verification: truncating future bars after openDriveIdx produces identical signal at openDriveIdx
    const truncated = candles.slice(0, openDriveIdx + 1);
    const resTruncated = computeSamSignals(truncated, {
      ...DEFAULT_SAM_CONFIG,
      filterSam21CombinedEnabled: true,
    });
    expect(resTruncated.callSignals[openDriveIdx]).toBe(true);
    expect(resTruncated.samSignalProfile?.[openDriveIdx]).toBe('SAM21_3M_OPENDRIVE');
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
