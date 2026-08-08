const fs = require('fs');

let types = fs.readFileSync('src/backend/types.ts', 'utf8');
const oldSessionState = /export interface StrategySessionState \{[\s\S]*?\n\}/;
const newSessionState = `export interface StrategySessionState {
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
}`;
types = types.replace(oldSessionState, newSessionState);

const oldInternalSignal = /export interface InternalSignal extends EngineDecision \{[\s\S]*?structureKey\?: string;\n\}/;
const newInternalSignal = `export interface InternalSignal extends EngineDecision {
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
}`;
// types = types.replace(oldInternalSignal, newInternalSignal);

fs.writeFileSync('src/backend/types.ts', types);
