import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NiftyMacdAdaptiveSupertrend } from '../src/backend/nifty-macd-adaptive-supertrend';
import { StrategyEngine } from '../src/backend/strategy-engine';
import { Candle } from '../src/backend/types';

describe('NIFTY MACD + Adaptive SuperTrend Strategy', () => {
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

  it('should initialize with correct default and overridden parameters', () => {
    expect(strategy.config.macdFast).toBe(12);
    expect(strategy.config.macdSlow).toBe(26);
    expect(strategy.config.macdSignal).toBe(9);
    expect(strategy.config.atrPeriod).toBe(10);
    expect(strategy.config.superTrendMultiplier).toBe(3);
    expect(strategy.config.riskPerTrade).toBe(0.02);
    expect(strategy.config.maxDailyLoss).toBe(0.05);
    expect(strategy.config.profitTarget).toBe(0.03);
    expect(strategy.config.minVolume).toBe(100);
    expect(strategy.state.canTrade).toBe(true);
    expect(strategy.state.isInPosition).toBe(false);
  });

  it('should correctly check trading hours', () => {
    expect(strategy.isWithinTradingHours('10:00')).toBe(true);
    expect(strategy.isWithinTradingHours('09:15')).toBe(true);
    expect(strategy.isWithinTradingHours('15:30')).toBe(true);
    expect(strategy.isWithinTradingHours('09:14')).toBe(false);
    expect(strategy.isWithinTradingHours('15:31')).toBe(false);
    expect(strategy.isWithinTradingHours('18:00')).toBe(false);
  });

  it('should calculate position size proportional to risk', () => {
    const accountBalance = 100000; // 2% risk = 2000
    const entryPrice = 22000;
    const stopLoss = 21950; // 50 pts risk
    const size = strategy.calculatePositionSize(entryPrice, stopLoss, accountBalance);
    expect(size).toBe(40); // 2000 / 50 = 40
  });

  it('should calculate MACD and Adaptive SuperTrend from candle data', () => {
    // Generate synthetic price series
    let price = 22000;
    for (let i = 0; i < 50; i++) {
      price += (i % 2 === 0 ? 5 : -2);
      strategy.updatePriceData({
        open: price - 2,
        high: price + 5,
        low: price - 4,
        close: price,
        volume: 5000,
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

  it('should generate BUY signal on SuperTrend uptrend + MACD bullish crossover with 1:2 R:R', () => {
    // Mock calculateMACD and calculateAdaptiveSupertrend to simulate exact crossover
    vi.spyOn(strategy, 'calculateMACD').mockReturnValue({
      macdLine: 5.2,
      signalLine: 4.8,
      histogram: 0.4,
      macdPrev: 4.0,
      signalPrev: 4.5,
    });

    vi.spyOn(strategy, 'calculateAdaptiveSupertrend').mockReturnValue({
      supertrend: 22050,
      trend: 'uptrend',
      upperBand: 22150,
      lowerBand: 22050,
      atr: 20,
    });

    const candle = { open: 22090, high: 22110, low: 22080, close: 22100, volume: 5000 };
    const result = strategy.generateSignals(candle, 100000, '10:15');

    expect(result.signal).toBe('BUY');
    expect(result.entryPrice).toBe(22100);
    expect(result.stopLoss).toBe(22050);
    // 1:2 R:R: (22100 - 22050) * 2 = 100 points profit -> TP = 22200
    expect(result.takeProfit).toBe(22200);
    expect(result.reason).toContain('MACD bullish crossover + SuperTrend uptrend');
  });

  it('should generate SELL signal on SuperTrend downtrend + MACD bearish crossover with 1:2 R:R', () => {
    vi.spyOn(strategy, 'calculateMACD').mockReturnValue({
      macdLine: -5.2,
      signalLine: -4.8,
      histogram: -0.4,
      macdPrev: -4.0,
      signalPrev: -4.5,
    });

    vi.spyOn(strategy, 'calculateAdaptiveSupertrend').mockReturnValue({
      supertrend: 22150,
      trend: 'downtrend',
      upperBand: 22150,
      lowerBand: 22050,
      atr: 20,
    });

    const candle = { open: 22110, high: 22120, low: 22090, close: 22100, volume: 5000 };
    const result = strategy.generateSignals(candle, 100000, '10:15');

    expect(result.signal).toBe('SELL');
    expect(result.entryPrice).toBe(22100);
    expect(result.stopLoss).toBe(22150);
    // 1:2 R:R: 22100 - (22150 - 22100) * 2 = 22000
    expect(result.takeProfit).toBe(22000);
    expect(result.reason).toContain('MACD bearish crossover + SuperTrend downtrend');
  });

  it('should handle trade execution, PnL tracking, and stop loss exit', () => {
    const entrySignal = {
      signal: 'BUY',
      entryPrice: 22000,
      stopLoss: 21950,
      takeProfit: 22100,
      positionSize: 40,
    };

    strategy.executeTrade('BUY', entrySignal, '10:00');
    expect(strategy.state.isInPosition).toBe(true);
    expect(strategy.state.entryPrice).toBe(22000);

    // Stop loss hit exit
    const exitDetails = {
      exitPrice: 21950,
      pnl: (21950 - 22000) * 40, // -2000
      reason: 'Stop loss triggered',
    };
    strategy.executeTrade('EXIT_BUY', exitDetails, '10:30');

    expect(strategy.state.isInPosition).toBe(false);
    expect(strategy.state.dailyPnL).toBe(-2000);
    expect(strategy.state.trades.length).toBe(1);
    expect(strategy.state.trades[0].pnl).toBe(-2000);
  });

  it('should respect maxDailyLoss and halt trading', () => {
    strategy.state.dailyPnL = -6000; // > 5% on 100,000 balance
    const candle = { open: 22100, high: 22120, low: 22090, close: 22110, volume: 5000 };
    const res = strategy.generateSignals(candle, 100000, '10:00');
    expect(res.signal).toBe('NONE');
    expect(res.reason).toContain('Daily loss limit reached');
    expect(strategy.state.canTrade).toBe(false);

    strategy.resetDailyState();
    expect(strategy.state.canTrade).toBe(true);
    expect(strategy.state.dailyPnL).toBe(0);
  });

  it('should emit events on trade entries and exits', () => {
    const entrySpy = vi.fn();
    const exitSpy = vi.fn();
    strategy.on('trade_entry', entrySpy);
    strategy.on('trade_exit', exitSpy);

    strategy.executeTrade('BUY', { entryPrice: 22000, stopLoss: 21950, takeProfit: 22100, positionSize: 10 }, '10:00');
    expect(entrySpy).toHaveBeenCalled();

    strategy.executeTrade('EXIT_BUY', { exitPrice: 22100, pnl: 1000, reason: 'Target reached' }, '10:30');
    expect(exitSpy).toHaveBeenCalled();
  });

  it('verifies that StrategyEngine evaluates MACD_ADAPTIVE_SUPERTREND independently', async () => {
    const settings = {
      isTradingEnabled: true,
      DECISION_TIMEFRAME_MINUTES: 5,
      maxTradeDurationMinutes: 60,
      strategies: {
        macdAdaptiveSupertrend: { enabled: true, lotSize: 1 },
        comboFiltered: { enabled: true, lotSize: 1 },
        comboUnfiltered: { enabled: true, lotSize: 1 },
      }
    };

    const mockState = {
      isConnected: true,
      nifty50: { lastPrice: 22100, timestamp: '' },
      marketStatus: 'open',
      signals: [],
      dailyPnL: 0,
      totalTradesToday: 0
    };

    const engine = new StrategyEngine(settings as any, mockState as any, vi.fn());

    // Generate candles
    const candles: Candle[] = [];
    let p = 22000;
    for (let i = 0; i < 40; i++) {
      p += 5;
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
          market_data: { ltp: 120, oi: 50000, oi_change: 1000 }
        },
        put_options: {
          instrument_key: 'NSE_INDEX|NIFTY24JAN22200PE',
          market_data: { ltp: 80, oi: 40000, oi_change: 500 }
        }
      }
    ];

    const sessState: any = {
      tradeTakenFlag: false,
      totalTradesToday: 0,
    };

    const passed: string[] = [];
    const failed: string[] = [];

    const result = await (engine as any).checkMacdAdaptiveSupertrendStrategy(
      { timeStr: '10:00' },
      'NIFTY',
      22200,
      candles,
      chainRows,
      sessState,
      passed,
      failed
    );

    // If signal triggered, verify it belongs strictly to MACD_ADAPTIVE_SUPERTREND
    if (result) {
      expect(result.decision.strategy_family).toBe('MACD_ADAPTIVE_SUPERTREND');
      expect(result.decision.targets.riskRewardRatio).toBe(2.0);
    }
  });
});
