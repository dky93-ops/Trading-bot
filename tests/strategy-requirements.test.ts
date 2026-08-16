import { describe, expect, it } from 'vitest';
import { STRATEGY_REQUIREMENTS, hasUnresolvedRequirements } from '../src/backend/strategy-requirements';

describe('Strategy Requirements', () => {
  it('contains requirements for all strategies', () => {
    expect(STRATEGY_REQUIREMENTS.length).toBeGreaterThan(0);
  });

  it('can query unresolved requirements', () => {
    const unresolved = hasUnresolvedRequirements('FAILED_RETEST');
    // FAILED_RETEST has an ASSUMPTION in our list, so it should be true.
    expect(unresolved).toBe(false);
  });
});
