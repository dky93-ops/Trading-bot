export type TradingSymbol = 'NIFTY';

export interface AppSettings {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  isTradingEnabled: boolean;
  nifty50Enabled: boolean;
  expiryDate: string;
  WALL_TOLERANCE_POINTS?: number;
  OPENING_RANGE_MINUTES?: number;
  defaultLotsPerTrade?: number;
  maxActiveTrades?: number;
  DECISION_TIMEFRAME_MINUTES?: number;
  MAX_OPTION_SPREAD_PERCENT?: number;
  MAX_OPTION_LOSS_PERCENT?: number;
  PREMIUM_CONFIRMATION_PERCENT?: number;
  OPENING_PREMIUM_CONFIRMATION_PERCENT?: number;
  WALL_OI_RATIO?: number;
  WALL_WEAKENING_PERCENT?: number;
  MAX_WALL_DISTANCE_ATR?: number;
  MIN_ENTRY_TIME_IST?: string;
  LAST_ENTRY_TIME_IST?: string;
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
  optionChainTimestamp: number;
  nifty50: InstrumentData;
  indiaVix: InstrumentData;
  isConnected: boolean;
  apiError?: string;
  signals: any[];
  overallPnL: number;
  realizedPnL?: number;
  unrealizedPnL?: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
}

export interface StrategySessionState {
  wallOiHistory?: Record<string, number[]>;
  wallStableByKey?: Record<string, boolean>;
  totalTradesToday: number;
  consecutiveLosses: number;
  feedSyncPenalty?: number;
  wallPeakOI?: Record<number, number>;
  wallNegativeOIAlignedKeys?: Record<number, string[]>;
  wallInvalidForRejection?: Record<number, boolean>;
  lastTradeExitTime: number;
  failedLevelsToday: number[];
  tradedStructures: string[];
  failedStructuresToday: string[];
  activeStructureId: string | null;
  lastFailedStructureId: string | null;
  sessionDateIST: string;

  candidateCEWalls: Record<number, boolean>;
  candidatePEWalls: Record<number, boolean>;
  wallTestCounts: Record<number, number>;
  wallTestCandleKeys: Record<number, string[]>;
  wallReactionCandleKeys: Record<number, string[]>;
  wallLastSeenOI: Record<number, number>;
  wallLastProcessedSnapshotKey: Record<number, string>;
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
  
  // Failed setup tracking
  last_failed_setup_level: number | null;
  last_failed_setup_direction: 'CALL' | 'PUT' | 'NONE' | null;
  last_failed_setup_timestamp: string | null;
  
  // Trades tracking
  completedTradesCount: number;
  realizedDailyPnL: number;
  consecutiveLosingTrades: number;
  noNewTradeFlag: boolean;

  lastTradeCandleTime: string | null;
  
  sessionHigh: number;
  sessionLow: number;
  previousDayHigh: number;
  previousDayLow: number;
  openingRangeHigh: number;
  openingRangeLow: number;
  openingRangeComplete: boolean;
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

export interface SignalPrices {
  spotEntry: number;
  spotInvalidation: number;
  spotTarget1: number;
  spotTarget2: number;
  optionEntry: number;
  optionStoploss: number;
  optionTarget1: number;
  optionTarget2: number;
}

export interface EngineDecision {
  timestamp: string;
  signal: 'BUY_CALL' | 'BUY_PUT' | 'NO_TRADE';
  strategy_family: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION' | 'NONE';
  direction: 'CALL' | 'PUT' | 'NONE';
  spot?: number;
  broken_level?: number;
  wall_above?: number;
  wall_below?: number;
  option_type?: 'CE' | 'PE' | 'NONE';
  strike?: number;
  entry: number;
  stoploss: number;
  target1: number;
  target2: number;
  confidence: number;
  reason: string[];
  fake_signal_filters_passed?: string[];
  fake_signal_filters_failed?: string[];
  spot_entry?: number;
  spot_invalidation?: number;
  spot_target1?: number;
  spot_target2?: number;
  option_entry?: number;
  option_stoploss?: number;
  option_target1?: number;
  option_target2?: number;
  instrumentKey?: string;
}

export interface InternalSignal extends EngineDecision {
  structuralStopSpot?: number;
  target1Spot?: number;
  target2Spot?: number;
  entrySpot?: number;
  initialRiskSpot?: number;
  prices: SignalPrices;
  spotEntry: number;
  spotInvalidation: number;
  spotTarget1: number;
  spotTarget2: number;
  optionEntry: number;
  optionStoploss: number;
  optionTarget1: number;
  optionTarget2: number;
  latestSpot?: number;
  latestSpotTimestamp?: number;
  latestOptionTimestamp?: number;
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
  exitReason?: string;
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
  bidPrice?: number;
  askPrice?: number;
  bidQty?: number;
  askQty?: number;
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
    strike?: number;
    spot?: number;
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
