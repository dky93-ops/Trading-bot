import { describe, it, expect } from 'vitest';
import {
  TradeNotificationEvent,
  mergeNotificationIdempotent,
  isFreshLiveCandleTime,
  formatTradeNotificationTitle,
  formatTradeNotificationBody,
} from './trade-notifications';

function makeEvent(overrides: Partial<TradeNotificationEvent> = {}): TradeNotificationEvent {
  return {
    id: 'OPEN:SAM:1764050000:CALL',
    kind: 'TRADE_OPENED',
    direction: 'CALL',
    signal: 'SAM CALL (1m Confirmed)',
    source: 'LIVE_CHART',
    timestamp: Date.now(),
    entryPrice: 25812.5,
    stoploss: 25792.5,
    target: 25872.5,
    optionStrike: 25800,
    optionType: 'CE',
    optionEntryPremium: 148.25,
    ...overrides,
  };
}

describe('trade-notifications', () => {
  it('merges notifications idempotently and rejects duplicate IDs', () => {
    const first = makeEvent({ id: 'OPEN:SAM:100:CALL' });
    const res1 = mergeNotificationIdempotent([], first, 10);
    expect(res1.added).toBe(true);
    expect(res1.list).toHaveLength(1);

    const dup = mergeNotificationIdempotent(res1.list, { ...first, entryPrice: 25900 }, 10);
    expect(dup.added).toBe(false);
    expect(dup.list).toHaveLength(1);
    expect(dup.list[0].entryPrice).toBe(25812.5);

    const second = makeEvent({ id: 'OPEN:SAM:200:PUT', direction: 'PUT' });
    const res2 = mergeNotificationIdempotent(res1.list, second, 10);
    expect(res2.added).toBe(true);
    expect(res2.list[0].id).toBe('OPEN:SAM:200:PUT');
    expect(res2.list[1].id).toBe('OPEN:SAM:100:CALL');
  });

  it('caps stored notifications at maxItems', () => {
    let list: TradeNotificationEvent[] = [];
    for (let i = 0; i < 8; i++) {
      list = mergeNotificationIdempotent(list, makeEvent({ id: `EVT:${i}` }), 5).list;
    }
    expect(list).toHaveLength(5);
    expect(list[0].id).toBe('EVT:7');
    expect(list[4].id).toBe('EVT:3');
  });

  it('accepts fresh live IST-shifted candle timestamps and rejects historical backtest bars', () => {
    const nowMs = Date.UTC(2026, 10, 25, 6, 30, 0); // 12:00:00 IST
    const liveChartSec = Math.floor(nowMs / 1000) + 19800 - 60; // 1 minute old
    const futureSkewSec = Math.floor(nowMs / 1000) + 19800 + 30; // +30s clock skew
    const staleChartSec = Math.floor(nowMs / 1000) + 19800 - 15 * 60; // 15 minutes old
    const yesterdayChartSec = Math.floor(nowMs / 1000) + 19800 - 86400; // 24h old

    expect(isFreshLiveCandleTime(liveChartSec, nowMs, 5)).toBe(true);
    expect(isFreshLiveCandleTime(futureSkewSec, nowMs, 5)).toBe(true);
    expect(isFreshLiveCandleTime(staleChartSec, nowMs, 5)).toBe(false);
    expect(isFreshLiveCandleTime(yesterdayChartSec, nowMs, 5)).toBe(false);
    expect(isFreshLiveCandleTime(undefined, nowMs, 5)).toBe(false);
  });

  it('formats titles and bodies accurately for opened, closed, and pending events', () => {
    const openEv = makeEvent();
    expect(formatTradeNotificationTitle(openEv)).toBe('NEW CALL TRADE • 25800 CE');
    expect(formatTradeNotificationBody(openEv)).toContain('Spot: 25812.50');
    expect(formatTradeNotificationBody(openEv)).toContain('SL: 25792.5');
    expect(formatTradeNotificationBody(openEv)).toContain('TP: 25872.5');
    expect(formatTradeNotificationBody(openEv)).toContain('Prem: ₹148.25');

    const closeEv = makeEvent({
      id: 'CLOSE:1',
      kind: 'TRADE_CLOSED',
      direction: 'PUT',
      optionStrike: 25750,
      optionType: 'PE',
      entryPrice: 25760,
      exitPrice: 25700,
      status: 'WIN',
      exitReason: 'TARGET',
      lotPnl: 1950,
    });
    expect(formatTradeNotificationTitle(closeEv)).toBe('TRADE WIN • 25750 PE');
    expect(formatTradeNotificationBody(closeEv)).toContain('Spot 25760.0 → 25700.0');
    expect(formatTradeNotificationBody(closeEv)).toContain('1 Lot: +₹1950');

    const pendingEv = makeEvent({
      id: 'PENDING:1',
      kind: 'SETUP_PENDING',
      direction: 'CALL',
    });
    expect(formatTradeNotificationTitle(pendingEv)).toBe('PENDING CALL SETUP • 25800 CE');
  });
});
