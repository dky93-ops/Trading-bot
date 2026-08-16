import { describe, expect, it } from 'vitest';
import {
  normalizeChainRows,
  readHistoricalPremium,
} from '../src/backend/strategy-data';

describe('strategy data adapters', () => {
  it('normalizes a wrapped option-chain response', () => {
    const response = {
      status: 'success',
      data: [
        {
          strike_price: 24000,
          call_options: {},
          put_options: {},
        },
      ],
    };

    const rows = normalizeChainRows(response);

    expect(rows).toHaveLength(1);
    expect(rows[0].strike_price).toBe(24000);
  });

  it('accepts an already-normalized array', () => {
    const rows = normalizeChainRows([
      { strike_price: 24050 },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].strike_price).toBe(24050);
  });

  it('reads premium from the saved rows format', () => {
    const history = [
      {
        timestamp: 1_000,
        rows: [
          {
            strike: 24000,
            ce: { ltp: 125.5 },
            pe: { ltp: 110.25 },
          },
        ],
      },
    ];

    expect(
      readHistoricalPremium(history, 24000, 'CE', 1_500),
    ).toBe(125.5);
  });

  it('rejects future snapshots', () => {
    const history = [
      {
        timestamp: 2_000,
        rows: [
          {
            strike: 24000,
            ce: { ltp: 125.5 },
          },
        ],
      },
    ];

    expect(
      readHistoricalPremium(history, 24000, 'CE', 1_500),
    ).toBeUndefined();
  });

  it('rejects missing premium', () => {
    const history = [
      {
        timestamp: 1_000,
        rows: [
          {
            strike: 24000,
            ce: { ltp: 0 },
          },
        ],
      },
    ];

    expect(
      readHistoricalPremium(history, 24000, 'CE', 1_500),
    ).toBeUndefined();
  });
});
