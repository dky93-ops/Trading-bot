import { describe, it, expect } from 'vitest';
import {
  IST_OFFSET_SEC,
  NIFTY_LOT_SIZE,
  CompactOptionSnapshot,
  OptionCandleBar,
  resolveTradeFromSnapshots,
  resolveTradeFromOptionCandles,
} from './option-premium-utils';
import { buildCompactOptionSnapshots } from '../backend/option-premium-resolver';

function istIsoToChartSec(istIso: string): number {
  const utcSec = Math.floor(new Date(istIso).getTime() / 1000);
  return utcSec + IST_OFFSET_SEC;
}

describe('Option Premium Lookup & Exact P&L Calculation', () => {
  const snapshots: CompactOptionSnapshot[] = [
    {
      t: new Date('2026-09-29T09:31:01+05:30').getTime(),
      spot: 22604.2,
      atm: 22600,
      expiry: '2026-09-29',
      ceLtp: 92.5,
      peLtp: 74.1,
      ceDelta: 0.54,
      peDelta: -0.46,
      strikes: {
        22550: { ce: 126.4, pe: 51.2, ceD: 0.65, peD: -0.35 },
        22600: { ce: 92.5, pe: 74.1, ceD: 0.54, peD: -0.46 },
        22650: { ce: 63.0, pe: 101.8, ceD: 0.42, peD: -0.58 },
      },
    },
    {
      t: new Date('2026-09-29T09:46:01+05:30').getTime(),
      spot: 22668.4, // Spot rallied +64.2 pts -> ATM shifted from 22600 to 22650!
      atm: 22650,
      expiry: '2026-09-29',
      ceLtp: 98.2, // 22650 CE (new ATM)
      peLtp: 68.5,
      ceDelta: 0.56,
      peDelta: -0.44,
      strikes: {
        22550: { ce: 168.0, pe: 31.0, ceD: 0.78, peD: -0.22 },
        22600: { ce: 132.75, pe: 46.2, ceD: 0.68, peD: -0.32 }, // Original traded 22600 CE!
        22650: { ce: 98.2, pe: 68.5, ceD: 0.56, peD: -0.44 },
      },
    },
  ];

  it('uses exact exit LTP of the SAME strike when spot moves to a new ATM (never spotPnl * delta)', () => {
    const res = resolveTradeFromSnapshots(
      {
        id: 't1',
        type: 'LONG',
        entryTime: istIsoToChartSec('2026-09-29T09:30:00+05:30'), // 1m bar closes 09:31:00
        entryPrice: 22604.2, // ATM 22600 CE
        exitTime: istIsoToChartSec('2026-09-29T09:45:00+05:30'), // 1m bar closes 09:46:00
        exitPrice: 22668.4,
        exitReason: 'OPPOSITE_SIGNAL',
        status: 'WIN',
        pnl: 64.2,
        timeframeMin: 1,
      },
      snapshots,
      NIFTY_LOT_SIZE
    );

    expect(res.optionDataSource).toBe('OPTION_CHAIN_HISTORY');
    expect(res.optionStrike).toBe(22600);
    expect(res.optionType).toBe('CE');
    expect(res.optionExpiry).toBe('2026-09-29');
    expect(res.optionEntryPremium).toBe(92.5);
    // Must read 22600 CE exit LTP (132.75), NOT new ATM 22650 CE (98.2) and NOT 92.5 + 64.2*0.54 (127.17)
    expect(res.optionExitPremium).toBe(132.75);
    expect(res.premiumPnl).toBe(40.25);
    expect(res.lotPnl).toBe(Number((40.25 * 65).toFixed(2)));
  });

  it('computes PUT option loss accurately as exitPeLtp - entryPeLtp for SHORT trades', () => {
    const res = resolveTradeFromSnapshots(
      {
        id: 't2',
        type: 'SHORT',
        entryTime: istIsoToChartSec('2026-09-29T09:30:00+05:30'),
        entryPrice: 22604.2, // 22600 PE
        exitTime: istIsoToChartSec('2026-09-29T09:45:00+05:30'),
        exitPrice: 22668.4,
        exitReason: 'STOPLOSS',
        status: 'LOSS',
        pnl: -64.2,
        timeframeMin: 1,
      },
      snapshots,
      NIFTY_LOT_SIZE
    );

    expect(res.optionDataSource).toBe('OPTION_CHAIN_HISTORY');
    expect(res.optionStrike).toBe(22600);
    expect(res.optionType).toBe('PE');
    expect(res.optionEntryPremium).toBe(74.1);
    expect(res.optionExitPremium).toBe(46.2);
    expect(res.premiumPnl).toBe(-27.9);
    expect(res.lotPnl).toBe(Number((-27.9 * 65).toFixed(2)));
  });

  it('never fabricates fake ₹100 / 0.50-delta premiums when no snapshot matches the trade date', () => {
    const res = resolveTradeFromSnapshots(
      {
        id: 't3',
        type: 'LONG',
        entryTime: istIsoToChartSec('2026-11-25T10:15:00+05:30'),
        entryPrice: 25812.0,
        exitTime: istIsoToChartSec('2026-11-25T10:45:00+05:30'),
        exitPrice: 25872.0,
        exitReason: 'TARGET',
        status: 'WIN',
        pnl: 60.0,
        timeframeMin: 1,
      },
      snapshots,
      NIFTY_LOT_SIZE
    );

    expect(res.optionDataSource).toBe('UNAVAILABLE');
    expect(res.optionEntryPremium).toBeUndefined();
    expect(res.optionExitPremium).toBeUndefined();
    expect(res.premiumPnl).toBeUndefined();
    expect(res.lotPnl).toBeUndefined();
  });

  it('resolves exact real premiums from Upstox 1-min option OHLC candles (close exit & intra-bar SL/TP)', () => {
    const bars: OptionCandleBar[] = [
      { t: new Date('2026-11-25T10:00:00+05:30').getTime(), o: 210, h: 215, l: 208, c: 214.5 },
      { t: new Date('2026-11-25T10:05:00+05:30').getTime(), o: 215, h: 245, l: 212, c: 240.0 },
    ];

    // 1. Close-based exit uses exact bar close
    const closeExit = resolveTradeFromOptionCandles(
      {
        id: 'c1',
        type: 'LONG',
        entryTime: istIsoToChartSec('2026-11-25T10:00:00+05:30'),
        entryPrice: 25805,
        exitTime: istIsoToChartSec('2026-11-25T10:05:00+05:30'),
        exitPrice: 25855,
        exitReason: 'DAY_END',
        status: 'WIN',
        pnl: 50,
        timeframeMin: 1,
      },
      bars,
      { expiry: '2026-12-01', strike: 25800, optType: 'CE', greekDelta: 0.52 },
      NIFTY_LOT_SIZE
    );

    expect(closeExit?.optionDataSource).toBe('UPSTOX_OPTION_CANDLE');
    expect(closeExit?.optionEntryPremium).toBe(214.5);
    expect(closeExit?.optionExitPremium).toBe(240.0);
    expect(closeExit?.premiumPnl).toBe(25.5);
    expect(closeExit?.lotPnl).toBe(Number((25.5 * 65).toFixed(2)));

    // 2. Intra-bar TARGET hit maps spot exit within [spotLow, spotHigh] onto [optLow, optHigh]
    const targetExit = resolveTradeFromOptionCandles(
      {
        id: 'c2',
        type: 'LONG',
        entryTime: istIsoToChartSec('2026-11-25T10:00:00+05:30'),
        entryPrice: 25805,
        exitTime: istIsoToChartSec('2026-11-25T10:05:00+05:30'),
        exitPrice: 25865,
        exitReason: 'TARGET',
        status: 'WIN',
        pnl: 60,
        timeframeMin: 1,
        exitSpotBar: { open: 25810, high: 25865, low: 25805, close: 25850 },
      },
      bars,
      { expiry: '2026-12-01', strike: 25800, optType: 'CE', greekDelta: 0.52 },
      NIFTY_LOT_SIZE
    );

    expect(targetExit?.optionExitPremium).toBe(245.0);
    expect(targetExit?.premiumPnl).toBe(30.5);
  });

  it('buildCompactOptionSnapshots preserves all strikes from raw option chain history', () => {
    const compact = buildCompactOptionSnapshots([
      {
        id: 'OC_1',
        timestamp: 1790583860364,
        timeISO: '2026-09-28T08:24:20.364Z',
        instrumentKey: 'NSE_INDEX|Nifty 50',
        expiryDate: '2026-09-29',
        spotPrice: 22834.65,
        totalCallOI: 1000,
        totalPutOI: 1000,
        pcr: 1,
        maxCallOIStrike: 22900,
        maxPutOIStrike: 22800,
        strikeCount: 2,
        rows: [
          {
            strike: 22800,
            ce: { ltp: 125.5, delta: 0.66 } as any,
            pe: { ltp: 48.2, delta: -0.34 } as any,
          },
          {
            strike: 22850,
            ce: { ltp: 95.4, delta: 0.5662 } as any,
            pe: { ltp: 70.15, delta: -0.4397 } as any,
          },
        ],
      },
    ]);

    expect(compact).toHaveLength(1);
    expect(compact[0].atm).toBe(22850);
    expect(compact[0].strikes?.[22800]?.ce).toBe(125.5);
    expect(compact[0].strikes?.[22850]?.pe).toBe(70.15);
  });
});
