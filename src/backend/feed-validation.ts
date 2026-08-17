export interface FeedSyncInput {
  candleStart: number;
  candleClose: number;
  optionSnapshotTimestamp: number;
  nowMs: number;
  maxSnapshotLagMs: number;
}

export function validateFeedSync(input: FeedSyncInput): { valid: boolean; reason?: string } {
  const values = [
    input.candleStart,
    input.candleClose,
    input.optionSnapshotTimestamp,
    input.nowMs,
  ];

  if (values.some(v => !Number.isFinite(v))) {
    return { valid: false, reason: 'FAILED_FEED_SYNC: invalid timestamp' };
  }

  if (input.optionSnapshotTimestamp < input.candleClose) {
    return { valid: false, reason: 'FAILED_FEED_SYNC: option snapshot is before candle close' };
  }

  if (input.optionSnapshotTimestamp > input.nowMs) {
    return { valid: false, reason: 'FAILED_FEED_SYNC: option snapshot is from the future' };
  }

  if (input.optionSnapshotTimestamp - input.candleClose > input.maxSnapshotLagMs) {
    return { valid: false, reason: 'FAILED_FEED_SYNC: option snapshot is stale' };
  }

  return { valid: true };
}
