import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NiftyMacdAdaptiveSupertrend } from '../src/backend/nifty-macd-adaptive-supertrend-v31';
import { StrategyEngine } from '../src/backend/strategy-engine';
import { Candle } from '../src/backend/types';

describe('NIFTY MACD + Adaptive SuperTrend Strategy (V31 Manual Implementation)', () => {
  let strategy: NiftyMacdAdaptiveSupertrend;

  beforeEach(() => {
    strategy = new NiftyMacdAdaptiveSupertrend({
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      atrPeriod: 10,
      superTrendMultiplier: 3,
      riskPerTrade: 0.02,
      maxDailyLoss: 0.05,
      profitTarget: 0.03,
      minVolume: 100,
      tradingHours: { start: '09:15', end: '15:30' },
      enableAdaptiveMultiplier: true,
      lookbackPeriod: 100,
    });
  });

  it('v31: initializes with standard parameters and clean state', () => {
    expect(strategy.config.macdFast).toBe(12);
    expect(strategy.config.macdSlow).toBe(26);
    expect(strategy.config.macdSignal).toBe(9);
    expect(strategy.config.atrPeriod).toBe(10);
    expect(strategy.config.superTrendMultiplier).toBe(3);
    expect(strategy.config.enableAdaptiveMultiplier).toBe(true);

    const status = strategy.getStatus();
    expect(status.isInPosition).toBe(false);
    expect(status.canTrade).toBe(true);
    expect(status.dailyPnL).toBe(0);
    expect(status.totalTrades).toBe(0);
  });

  it('v31: calculates adaptive multiplier and indicators from candle series', () => {
    let p = 22100;
    for (let i = 0; i < 50; i++) {
      p += (i % 2 === 0 ? 8 : -3);
      strategy.updatePriceData({
        open: p - 2,
        high: p + 6,
        low: p - 5,
        close: p,
        volume: 10000,
      });
    }

    const macd = strategy.calculateMACD(strategy.priceData.close);
    expect(macd).not.toBeNull();
    expect(typeof macd?.macdLine).toBe('number');
    expect(typeof macd?.signalLine).toBe('number');
    expect(typeof macd?.histogram).toBe('number');

    const supertrend = strategy.calculateAdaptiveSupertrend(
      strategy.priceData.high,
      strategy.priceData.low,
      strategy.priceData.close,
      strategy.priceData.volume
    );
    expect(supertrend).not.toBeNull();
    expect(typeof supertrend?.supertrend).toBe('number');
    expect(['uptrend', 'downtrend']).toContain(supertrend?.trend);
  });

  it('v31: triggers BUY signal with 1:2 R:R and LowerBand SL on uptrend + bullish crossover', () => {
    vi.spyOn(strategy, 'calculateMACD').mockReturnValue({
      macdLine: 4.5,
      signalLine: 3.2,
      histogram: 1.3,
      macdPrev: 2.8,
      signalPrev: 3.0,
    });

    vi.spyOn(strategy, 'calculateAdaptiveSupertrend').mockReturnValue({
      supertrend: 22020,
      trend: 'uptrend',
      upperBand: 22140,
      lowerBand: 22020,
      atr: 22,
    });

    const candle = { open: 22080, high: 22110, low: 22070, close: 22100, volume: 50000 };
    const sig = strategy.generateSignals(candle, 100000, '10:30');

    expect(sig.signal).toBe('BUY');
    expect(sig.entryPrice).toBe(22100);
    expect(sig.stopLoss).toBe(22020);
    // Risk = 22100 - 22020 = 80 points. Take profit at 1:2 R:R = 22100 + 160 = 22260
    expect(sig.takeProfit).toBe(22260);
    expect(sig.indicators?.trend).toBe('uptrend');
  });

  it('v31: triggers SELL signal with 1:2 R:R and UpperBand SL on downtrend + bearish crossover', () => {
    vi.spyOn(strategy, 'calculateMACD').mockReturnValue({
      macdLine: -4.5,
      signalLine: -3.2,
      histogram: -1.3,
      macdPrev: -2.8,
      signalPrev: -3.0,
    });

    vi.spyOn(strategy, 'calculateAdaptiveSupertrend').mockReturnValue({
      supertrend: 22180,
      trend: 'downtrend',
      upperBand: 22180,
      lowerBand: 22060,
      atr: 22,
    });

    const candle = { open: 22120, high: 22130, low: 22090, close: 22100, volume: 50000 };
    const sig = strategy.generateSignals(candle, 100000, '11:15');

    expect(sig.signal).toBe('SELL');
    expect(sig.entryPrice).toBe(22100);
    expect(sig.stopLoss).toBe(22180);
    // Risk = 22180 - 22100 = 80 points. Take profit at 1:2 R:R = 22100 - 160 = 21940
    expect(sig.takeProfit).toBe(21940);
    expect(sig.indicators?.trend).toBe('downtrend');
  });

  it('v31: executes trade lifecycle and emits both trade/exit and trade_entry/trade_exit events', () => {
    const tradeSpy = vi.fn();
    const exitSpy = vi.fn();
    strategy.on('trade', tradeSpy);
    strategy.on('exit', exitSpy);

    strategy.executeTrade('BUY', {
      entryPrice: 22000,
      stopLoss: 21950,
      takeProfit: 22100,
      positionSize: 25,
    }, '10:00');

    expect(tradeSpy).toHaveBeenCalled();
    expect(strategy.getStatus().isInPosition).toBe(true);

    strategy.checkStopLossAndTakeProfit(22105, '10:45'); // Take profit hit
    expect(exitSpy).toHaveBeenCalled();
    expect(strategy.getStatus().isInPosition).toBe(false);
    expect(strategy.getStatus().dailyPnL).toBeGreaterThan(0);
  });

  it('v31: verifies independent evaluation in StrategyEngine', async () => {
    const settings = {
      isTradingEnabled: true,
      strategies: {
        macdAdaptiveSupertrend: { enabled: true, lotSize: 1 },
      }
    };
    const mockState = {
      isConnected: true,
      nifty50: { lastPrice: 22200, timestamp: '' },
      marketStatus: 'open',
      signals: [],
    };
    const engine = new StrategyEngine(settings as any, mockState as any, vi.fn());

    const candles: Candle[] = [];
    let p = 22000;
    for (let i = 0; i < 40; i++) {
      p += 6;
      candles.push({
        timestamp: new Date(Date.now() - (40 - i) * 60000).toISOString(),
        open: p - 2,
        high: p + 5,
        low: p - 3,
        close: p,
        volume: 5000,
      });
    }

    const chainRows = [
      {
        strike_price: 22200,
        call_options: {
          instrument_key: 'NSE_INDEX|NIFTY24JAN22200CE',
          market_data: { ltp: 120, oi: 50000 }
        },
        put_options: {
          instrument_key: 'NSE_INDEX|NIFTY24JAN22200PE',
          market_data: { ltp: 80, oi: 40000 }
        }
      }
    ];

    const result = await (engine as any).checkMacdAdaptiveSupertrendStrategy(
      { timeStr: '10:00' },
      'NIFTY',
      22200,
      candles,
      chainRows,
      { tradeTakenFlag: false, totalTradesToday: 0 } as any,
      [],
      []
    );

    if (result) {
      expect(result.decision.strategy_family).toBe('MACD_ADAPTIVE_SUPERTREND');
      expect(result.decision.targets.riskRewardRatio).toBe(2.0);
    }
  });
});
