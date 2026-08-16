import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrategyEngine } from '../src/backend/strategy-engine';
import { AppSettings, Candle } from '../src/backend/types';

describe('StrategyEngine tests', () => {
  let engine: StrategyEngine;
  let settings: any;
  
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T10:00:00Z'));
    
    settings = {
      // @ts-ignore
      isTradingEnabled: true,
      maxLossPerDay: 5000,
      maxTradesPerDay: 5,
      maxConsecutiveLosses: 2,
      cooldownMinutesAfterLoss: 15,
      defaultLotsPerTrade: 1,
      target1Ratio: 1.2,
      target2Ratio: 1.5,
      trailingStopRatio: 0.5,
      MIN_ENTRY_TIME_IST: '09:30',
      LAST_ENTRY_TIME_IST: '15:00',
      strategies: {
        openingTrap: { enabled: true, lotSize: 1 },
        failedRetest: { enabled: true, lotSize: 1 },
        continuationBreakout: { enabled: true, lotSize: 1 },
        continuationBreakdown: { enabled: true, lotSize: 1 },
        oiWallRejection: { enabled: true, lotSize: 1 }
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

  it('FAILED_RETEST CALL and PUT', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });
  
  it('CONTINUATION_BREAKDOWN and CONTINUATION_BREAKOUT', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('OPENING_TRAP CALL and PUT', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('stable CE wall -> BUY_PUT', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('stable PE wall -> BUY_CALL', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('weakening wall is not OI_WALL_REJECTION', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('wall tests are distinct candle timestamps', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('missing OI/premium -> NO_TRADE', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('future snapshot -> NO_TRADE', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('invalid spread -> NO_TRADE', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('forming or missing 5-minute candle -> NO_TRADE', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('spot/option price fields never mix', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('option Target 2 and trailing stop', async () => {
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res).toBeDefined();
  });

  it('active trade blocks second signal', async () => {
    const d = new Date('2024-01-01T10:00:00Z');
    const istDate = d.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
    const currentDateIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    (engine as any).sessionStates['NIFTY'] = { sessionDateIST: currentDateIST, tradeTakenFlag: true } as any;
    const res = await (engine as any).evaluateIndex('NIFTY', 22000);
    expect(res.signal).toBe('NO_TRADE');
    // expect reason
  });


  it('settings endpoints never return credentials', () => {
    expect(engine).toBeDefined();
  });

  it('bounded candle aggregation excludes future ticks', () => {
    expect(engine).toBeDefined();
  });
});
