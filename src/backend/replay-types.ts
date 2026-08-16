export interface ReplayEvent {
  timestamp: number;
  type: 'CANDLE' | 'OPTION_CHAIN';
  payload: unknown;
}

export interface ReplayDecision {
  timestamp: number;
  signal: string;
  strategy: string;
  reason: string[];
}

export interface ReplayReport {
  decisions: ReplayDecision[];
  signals: ReplayDecision[];
  noTradeReasons: string[];
  usedFutureData: boolean;
}

export function createReplayReport(): ReplayReport {
  return {
    decisions: [],
    signals: [],
    noTradeReasons: [],
    usedFutureData: false,
  };
}
