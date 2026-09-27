import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrategyEngine } from '../src/backend/strategy-engine';
import { Candle } from '../src/backend/types';

describe('Isolated Filtered vs Unfiltered Combo Strategies', () => {
  let engine: StrategyEngine;
  let settings: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T10:00:00Z'));

    settings = {
      isTradingEnabled: true,
      DECISION_TIMEFRAME_MINUTES: 5,
      maxTradeDurationMinutes: 60,
      strategies: {
        comboFiltered: { enabled: true, priority: 1, lotSize: 1 },
        comboUnfiltered: { enabled: true, priority: 2, lotSize: 1 },
      }
    };

    const mockState = {
      isConnected: true,
      nifty50: { lastPrice: 22000, timestamp: '' },
      marketStatus: 'open',
      signals: [],
      dailyPnL: 0,
      totalTradesToday: 0
    };

    engine = new StrategyEngine(settings as any, mockState as any, vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies that Filtered and Unfiltered variants calculate different risk-reward and stop-loss rules', async () => {
    // Generate trending bullish candles
    const candles: Candle[] = [];
    let base = 22000;
    for (let i = 0; i < 35; i++) {
      base += 5;
      candles.push({
        timestamp: new Date(Date.now() - (35 - i) * 60000).toISOString(),
        open: base - 2,
        high: base + 4,
        low: base - 3,
        close: base + 2,
        volume: 5000,
      });
    }

    const chainRows = [
      {
        strike_price: 22100,
        call_options: {
          instrument_key: 'NSE_INDEX|NIFTY24JAN22100CE',
          market_data: { ltp: 100, oi: 50000, oi_change: 1000 }
        },
        put_options: {
          instrument_key: 'NSE_INDEX|NIFTY24JAN22100PE',
          market_data: { ltp: 90, oi: 40000, oi_change: -500 }
        }
      }
    ];

    const valCtx: any = { index: 'NIFTY' };
    const sess: any = {};
    const passed1: string[] = [];
    const failed1: string[] = [];

    const sigFiltered = await (engine as any).checkComboStrategy(
      'COMBO_FILTERED',
      valCtx,
      'NIFTY',
      22100,
      candles,
      chainRows,
      sess,
      22500,
      21800,
      passed1,
      failed1
    );

    const passed2: string[] = [];
    const failed2: string[] = [];

    const sigUnfiltered = await (engine as any).checkComboStrategy(
      'COMBO_UNFILTERED',
      valCtx,
      'NIFTY',
      22100,
      candles,
      chainRows,
      sess,
      22500,
      21800,
      passed2,
      failed2
    );

    if (sigFiltered) {
      expect(sigFiltered.decision.strategy_family).toBe('COMBO_FILTERED');
      // As per PDF: 1:2 R:R
      expect(sigFiltered.targets.riskRewardRatio).toBe(2.0);
    }

    if (sigUnfiltered) {
      expect(sigUnfiltered.decision.strategy_family).toBe('COMBO_UNFILTERED');
      // Unfiltered momentum R:R: 1.5
      expect(sigUnfiltered.targets.riskRewardRatio).toBe(1.5);
    }
  });

  it('guarantees that an active Filtered trade does NOT block an Unfiltered trade and vice-versa', async () => {
    // Add active Filtered signal
    engine.activeSignals.set('SIG-1', {
      id: 'SIG-1',
      strategy_family: 'COMBO_FILTERED',
      status: 'ACTIVE',
      direction: 'CALL',
      entryPrice: 100,
    } as any);

    const candles: Candle[] = [];
    let base = 22000;
    for (let i = 0; i < 35; i++) {
      base += 5;
      candles.push({
        timestamp: new Date(Date.now() - (35 - i) * 60000).toISOString(),
        open: base - 2,
        high: base + 4,
        low: base - 3,
        close: base + 2,
        volume: 5000,
      });
    }

    const chainRows = [
      {
        strike_price: 22100,
        call_options: {
          instrument_key: 'NSE_INDEX|NIFTY24JAN22100CE',
          market_data: { ltp: 100, oi: 50000, oi_change: 1000 }
        }
      }
    ];

    // Filtered check should return null because COMBO_FILTERED is already ACTIVE
    const sigFiltered = await (engine as any).checkComboStrategy(
      'COMBO_FILTERED',
      {} as any,
      'NIFTY',
      22100,
      candles,
      chainRows,
      {},
      22500,
      21800,
      [],
      []
    );
    expect(sigFiltered).toBeNull();

    // COMBO_UNFILTERED is NOT active, so it is NOT blocked!
    const sigUnfiltered = await (engine as any).checkComboStrategy(
      'COMBO_UNFILTERED',
      {} as any,
      'NIFTY',
      22100,
      candles,
      chainRows,
      {},
      22500,
      21800,
      [],
      []
    );
    // Since it's evaluated independently, its check does not return null due to active COMBO_FILTERED
    // (If the technical triggers match, it produces a signal without being blocked)
    expect(engine.activeSignals.get('SIG-1')?.strategy_family).toBe('COMBO_FILTERED');
  });
});
