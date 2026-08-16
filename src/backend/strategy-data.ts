export type OptionSide = 'CE' | 'PE';

export function normalizeChainRows(response: unknown): any[] {
  const rows = Array.isArray(response)
    ? response
    : (response as any)?.data;

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter((row: any) => Number.isFinite(Number(row?.strike_price)))
    .sort(
      (a: any, b: any) =>
        Number(a.strike_price) - Number(b.strike_price),
    );
}

export function readHistoricalPremium(
  history: any[],
  strike: number,
  type: OptionSide,
  timestamp: string | number | Date,
  maxAgeMs = 90_000,
): number | undefined {
  const targetMs = new Date(timestamp).getTime();

  if (!Number.isFinite(targetMs)) {
    return undefined;
  }

  let bestSnapshot: any | undefined;

  for (const snapshot of Array.isArray(history) ? history : []) {
    const snapshotMs = Number(
      snapshot?.timestamp ??
        new Date(snapshot?.timeISO || '').getTime(),
    );

    if (!Number.isFinite(snapshotMs)) {
      continue;
    }

    if (
      snapshotMs <= targetMs &&
      targetMs - snapshotMs <= maxAgeMs &&
      (!bestSnapshot ||
        snapshotMs >
          Number(
            bestSnapshot.timestamp ??
              new Date(bestSnapshot.timeISO || '').getTime(),
          ))
    ) {
      bestSnapshot = snapshot;
    }
  }

  if (!bestSnapshot) {
    return undefined;
  }

  const rows = Array.isArray(bestSnapshot.rows)
    ? bestSnapshot.rows
    : Array.isArray(bestSnapshot.data)
      ? bestSnapshot.data
      : [];

  const row = rows.find(
    (candidate: any) =>
      Number(candidate?.strike ?? candidate?.strike_price) === strike,
  );

  if (!row) {
    return undefined;
  }

  const option =
    type === 'CE'
      ? row.ce ?? row.call_options
      : row.pe ?? row.put_options;

  const marketData = option?.market_data ?? option ?? {};

  const price = Number(
    marketData.ltp ??
      marketData.last_price ??
      marketData.price,
  );

  return Number.isFinite(price) && price > 0
    ? price
    : undefined;
}

export interface ExecutableOptionQuote {
  bid: number;
  ask: number;
  ltp?: number;
}

export function validateExecutableQuote(
  quote: ExecutableOptionQuote | undefined,
  maxSpreadPercent: number,
): { valid: boolean; reason?: string } {
  if (!quote) {
    return {
      valid: false,
      reason: 'MISSING_QUOTE',
    };
  }

  if (
    !Number.isFinite(quote.bid) ||
    !Number.isFinite(quote.ask) ||
    quote.bid <= 0 ||
    quote.ask <= 0 ||
    quote.ask < quote.bid
  ) {
    return {
      valid: false,
      reason: 'INVALID_BID_ASK',
    };
  }

  const midpoint = (quote.bid + quote.ask) / 2;
  const spreadPercent =
    ((quote.ask - quote.bid) / midpoint) * 100;

  if (spreadPercent > maxSpreadPercent) {
    return {
      valid: false,
      reason: `SPREAD_TOO_WIDE:${spreadPercent.toFixed(3)}`,
    };
  }

  return { valid: true };
}
