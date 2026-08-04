export interface AppSettings {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  isTradingEnabled: boolean;
  nifty50Enabled: boolean;
  bankNiftyEnabled?: boolean;
  expiryDate: string;
  defaultLotsPerTrade?: number;
  maxActiveTrades?: number;
  strategies: {
    openingTrap: StrategyConfig;
    failedRetest: StrategyConfig;
    continuationBreakdown: StrategyConfig;
    continuationBreakout: StrategyConfig;
    oiWallRejection: StrategyConfig;
  };
}

export interface StrategyConfig {
  enabled: boolean;
  lotSize: number;
  slPercent?: number;
  targetPercent?: number;
  trailingEnabled?: boolean;
}

export interface InstrumentData {
  lastPrice: number;
  change: number;
  timestamp: any;
}

export interface AppState {
  nifty50: InstrumentData;
  bankNifty?: InstrumentData;
  indiaVix: InstrumentData;
  isConnected: boolean;
  apiError?: string;
  signals: Signal[];
  overallPnL: number;
  realizedPnL?: number;
  unrealizedPnL?: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
}

export interface Signal {
  id: string;
  timestamp: string | number;
  index: string;
  contract: string;
  instrumentKey?: string;
  action: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  latestPrice?: number;
  stopLoss: number;
  target: number;
  exitPrice?: number;
  exitTime?: number;
  realizedPnL?: number;
  status: 'ACTIVE' | 'CLOSED';
  highestPrice?: number;
  partialExit?: boolean;
  leg?: 'MAIN' | 'HEDGE';
  isStraddle?: boolean;
  breakevenShifted?: boolean;
  timeStop?: string;
  tradeType?: 'CE' | 'PE';
  firstTargetHitFlag?: boolean;
  trailingStopActiveFlag?: boolean;
  confirmationCandleLow?: number;
  confirmationCandleHigh?: number;
  initialRiskPoints?: number;
  confirmationZonePrice?: number;

  // Specific 5-Strategy Engine JSON fields
  signal: 'BUY_CALL' | 'BUY_PUT' | 'NO_TRADE';
  strategy_family: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION' | 'NONE';
  direction: 'CALL' | 'PUT' | 'NONE';
  spot: number;
  broken_level: number;
  wall_above: number;
  wall_below: number;
  option_type: 'CE' | 'PE' | 'NONE';
  strike: number;
  entry: number;
  stoploss: number;
  target1: number;
  target2: number;
  confidence: number;
  reason: string[];
  fake_signal_filters_passed: string[];
  fake_signal_filters_failed: string[];
}

export interface Candle {
  timestamp: any;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionChainSnapshot {
  id: string;
  timestamp: number;
  timeISO: string;
  instrumentKey: string;
  expiryDate: string;
  spotPrice: number;
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
  maxCallOIStrike: number;
  maxPutOIStrike: number;
  strikeCount: number;
  rows: Array<{
    strike: number;
    spot: number;
    ce: { price: number; oi: number; oiChange: number; volume: number; iv: number };
    pe: { price: number; oi: number; oiChange: number; volume: number; iv: number };
  }>;
}
