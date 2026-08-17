import { describe, expect, it } from 'vitest';
import { StrategyEngine } from '../src/backend/strategy-engine';

describe('clock rules', () => {
  it('correctly maps time to window', () => {
    const engine = new StrategyEngine({} as any, {} as any, async () => {});
    
    let d = new Date('2024-01-01T09:16:00+05:30').getTime();
    expect((engine as any).getTimeWindow(d)).toBe('09:15-09:20');

    d = new Date('2024-01-01T09:21:00+05:30').getTime();
    expect((engine as any).getTimeWindow(d)).toBe('09:20-10:00');

    d = new Date('2024-01-01T11:00:00+05:30').getTime();
    expect((engine as any).getTimeWindow(d)).toBe('10:00-12:30');

    d = new Date('2024-01-01T13:00:00+05:30').getTime();
    expect((engine as any).getTimeWindow(d)).toBe('12:30-13:30');

    d = new Date('2024-01-01T14:00:00+05:30').getTime();
    expect((engine as any).getTimeWindow(d)).toBe('13:30-15:00');

    d = new Date('2024-01-01T15:01:00+05:30').getTime();
    expect((engine as any).getTimeWindow(d)).toBe('POST-15:00');
  });
});
