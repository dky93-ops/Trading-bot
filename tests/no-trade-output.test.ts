import { describe, expect, it } from 'vitest';
import { StrategyEngine } from '../src/backend/strategy-engine';

describe('no-trade output format', () => {
  it('preserves public NO_TRADE shape', () => {
    const engine = new StrategyEngine({} as any, {} as any, async () => {});
    const decision = (engine as any).createNoTrade('NIFTY', 22000, 'Test reason');
    
    expect(decision).not.toBeNull();
    expect(decision.signal).toBe('NO_TRADE');
    expect(decision.strategy_family).toBe('NONE');
    expect(decision.direction).toBe('NONE');
    expect(decision.option_type).toBe('NONE');
    expect(decision.entry).toBe(0);
    expect(decision.stoploss).toBe(0);
    expect(decision.target1).toBe(0);
    expect(decision.target2).toBe(0);
    expect(decision.reason).toContain('Test reason');
  });
});
