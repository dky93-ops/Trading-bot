export type TradingSymbol = 'NIFTY';

export interface AppSettings {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  isTradingEnabled: boolean;
  nifty50Enabled: boolean;
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
  indiaVix: InstrumentData;
  isConnected: boolean;
  apiError?: string;
  signals: EngineDecision[];
  overallPnL: number;
  realizedPnL?: number;
  unrealizedPnL?: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
}

export interface StrategySessionState {
  lastTradeExitTime: number;
  failedLevelsToday: number[];
  tradedStructures: string[];
  failedStructuresToday: string[];
  activeStructureId: string | null;
  lastFailedStructureId: string | null;
  sessionDateIST: string;

  wallTestCounts: Record<number, number>;
  wallTestCandleKeys: Record<number, string[]>;
  wallReactionCandleKeys: Record<number, string[]>;
  wallLastSeenOI: Record<number, number>;
  wallOIWeakeningConfirmed: Record<number, boolean>;
  
  prevWallTotalOI: Record<number, number>;
  wallNegativeOICounts: Record<number, number>;

  brokenLevelUnderWatch: number | null;
  retestPendingFlag: boolean;
  continuationPendingFlag: boolean;
  
  tradeTakenFlag: boolean;
  firstTargetHitFlag: boolean;
  trailingStopActiveFlag: boolean;
  lastSignalDirection: 'CALL' | 'PUT' | 'NONE';
  lastFailedSetupLevel: number | null;
  lastTradeCandleTime: string | null;
  
  sessionHigh: number;
  sessionLow: number;
  previousDayHigh: number;
  previousDayLow: number;
  openingRangeHigh: number;
  openingRangeLow: number;
  nearestCeWallAbove: number;
  nearestPeWallBelow: number;

  confirmedBreakoutTimestamp: string | null;
  confirmedBreakoutLevel: number | null;
  confirmedBreakoutDirection: 'CALL' | 'PUT' | null;

  retestTimestamp: string | null;
  retestLevel: number | null;
  retestDirection: 'CALL' | 'PUT' | null;
  
  lastProcessedCandleTimestamp: string | null;
  currentStrategyFamily: string | null;
  lastConfirmedReclaimLevel: number | null;
}

export interface EngineDecision {
  timestamp: string;
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

export interface InternalSignal extends EngineDecision {
  id: string;
  index: string;
  contract: string;
  instrumentKey?: string;
  action: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  latestPrice?: number;
  exitPrice?: number;
  exitTime?: number;
  realizedPnL?: number;
  status: 'ACTIVE' | 'CLOSED';
  highestPrice?: number;
  partialExit?: boolean;
  leg?: 'MAIN' | 'HEDGE';
  isStraddle?: boolean;
  firstTargetHitFlag?: boolean;
  trailingStopActiveFlag?: boolean;
  breakevenShifted?: boolean;
  timeStop?: string;
  tradeType?: 'CE' | 'PE';
  confirmationCandleLow?: number;
  confirmationCandleHigh?: number;
  initialRiskPoints?: number;
  confirmationZonePrice?: number;
  structureId?: string;
  barsSinceBreakout?: number;
  barsSinceRetest?: number;
  premiumTrend?: number[];
  oiTrend?: number[];
  impulseRange?: number;
  structureKey?: string;
}

export interface Candle {
  timestamp: any;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionData {
  ltp: number;
  totalOi: number;
  oiChange: number;
  volume: number;
  iv: number;
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
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
    ce: OptionData;
    pe: OptionData;
  }>;
}

export interface ValidationSeries {
  spotSeriesLast3: number[];
  callPremiumSeriesLast3: number[];
  putPremiumSeriesLast3: number[];
  callOiSeriesLast3: number[];
  putOiSeriesLast3: number[];
  oppCallOiSeriesLast3: number[];
  oppPutOiSeriesLast3: number[];
  volumeSeriesLast3: number[];
  ivSeriesLast3: number[];
  deltaSeriesLast3: number[];
  thetaSeriesLast3: number[];
  gammaSeriesLast3: number[];
  vegaSeriesLast3: number[];
}
