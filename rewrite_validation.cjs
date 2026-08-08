const fs = require('fs');

const rulesContent = `
import { StrategySessionState, Candle, InternalSignal } from './types.js';

export interface ProposedSetup {
  direction: 'CALL' | 'PUT';
  level: number;
  setupType: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION';
  c0: Candle; // Confirmation candle (current)
  c1: Candle; // Previous
  c2?: Candle; // Pre-previous
  target1: number;
  target2: number;
  stopLoss: number;
  ceOpt?: any;
  peOpt?: any;
  structureId?: string;
  barsSinceBreakout?: number;
  barsSinceRetest?: number;
  impulseRange?: number;
  spotMoveFromLevel?: number;
  callPremiumSeriesLast3?: number[];
  putPremiumSeriesLast3?: number[];
}

export interface ValidationContext {
  activeSignals: Map<string, InternalSignal>;
  index: string;
  spotPrice: number;
  timeObj: Date;
  timeStr: string;
  sessState: StrategySessionState;
  candles1m: Candle[];
  chainRows: any[];
  nearestCeWallAbove: number;
  nearestPeWallBelow: number;
}

export interface RuleResult {
  passed: boolean;
  reason?: string;
}

export const pass = (): RuleResult => ({ passed: true });
export const fail = (reason: string): RuleResult => ({ passed: false, reason });

// GLOBAL PRECHECKS
export function runGlobalPreChecks(ctx: ValidationContext): RuleResult {
  const { timeStr, activeSignals, sessState, timeObj, candles1m } = ctx;
  
  if (timeStr < '09:15') return fail('FAILED_TIME_FILTER: Pre-market');
  if (timeStr >= '15:30') return fail('FAILED_TIME_FILTER: Post-market');
  
  if (candles1m.length === 0) return fail('FAILED_COMPLETED_CANDLE: No candles available');
  const currentMinuteStart = Math.floor(timeObj.getTime() / 60000) * 60000;
  const hasIncomplete = candles1m.some(c => new Date(c.timestamp).getTime() >= currentMinuteStart);
  if (hasIncomplete) return fail('FAILED_COMPLETED_CANDLE: Most recent candle is not closed');
  
  if (activeSignals && activeSignals.size >= 1) return fail('FAILED_MAX_TRADES: A trade is already active');
  
  if (sessState.lastTradeExitTime > 0 && (timeObj.getTime() - sessState.lastTradeExitTime) < 120000) {
    return fail('FAILED_COOLDOWN: Under 2-minute post-trade cooldown');
  }
  
  return pass();
}

// SETUP VALIDATION
export function rule2OpeningFilter(timeStr: string, setup: ProposedSetup): RuleResult {
  if (timeStr < '09:20') {
    if (!setup.c0 || !setup.c1 || !setup.c2) return fail('FAILED_TIME_FILTER: Pre-09:20 requires exceptional clarity and full confirmation');
  } else if (timeStr < '09:30') {
    if (!setup.c0 || !setup.c1) return fail('FAILED_TIME_FILTER: 09:20-09:30 requires genuinely strong fully confirmed setup');
  }
  return pass();
}

export function rule5MarketStructure(sessState: StrategySessionState, setup: ProposedSetup): RuleResult {
  if (sessState.failedStructuresToday && sessState.failedStructuresToday.includes(setup.structureId || '')) {
    return fail('FAILED_MARKET_STRUCTURE: Structure already failed today');
  }
  return pass();
}

export function rule6FailedLevel(sessState: StrategySessionState, setup: ProposedSetup): RuleResult {
  if (sessState.failedLevelsToday && sessState.failedLevelsToday.includes(setup.level)) {
    return fail('FAILED_LEVEL: Level has already failed today');
  }
  return pass();
}

export function rule7ValidLevels(setup: ProposedSetup, validLevels: number[]): RuleResult {
  if (!validLevels.includes(setup.level)) {
    return fail('FAILED_VALID_LEVEL: Level is not a recognized ORH/ORL/PDH/PDL/Wall');
  }
  return pass();
}

export function rule8DominantOIWall(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType !== 'OI_WALL_REJECTION') return pass();
  const chainRows = ctx.chainRows;
  if (!chainRows || chainRows.length < 5) return fail('FAILED_DOMINANT_WALL: Missing chain data');
  if (!setup.level || setup.level === 0) return fail('FAILED_DOMINANT_WALL: No valid dominant OI wall found at this level');

  const sortedRows = [...chainRows].sort((a, b) => a.strike_price - b.strike_price);
  const wallRowIndex = sortedRows.findIndex(r => r.strike_price === setup.level);
  
  if (wallRowIndex < 2 || wallRowIndex > sortedRows.length - 3) {
    return fail('FAILED_DOMINANT_WALL: Strike not found or insufficient surrounding strikes');
  }

  const row = sortedRows[wallRowIndex];
  const surr = [
    sortedRows[wallRowIndex - 2], sortedRows[wallRowIndex - 1], 
    sortedRows[wallRowIndex + 1], sortedRows[wallRowIndex + 2]
  ];

  if (setup.direction === 'PUT') {
    const callOI = row.call_options?.market_data?.oi || 0;
    const callOIChange = row.call_options?.market_data?.oi_change || 0;
    const surrCallOI = surr.reduce((sum, r) => sum + (r.call_options?.market_data?.oi || 0), 0) / 4;
    
    if (surrCallOI === 0 || callOI < 1.5 * surrCallOI) return fail('FAILED_DOMINANT_WALL: CE OI is not 1.5x dominant');
    if (callOIChange < -0.05 * callOI) return fail('FAILED_DOMINANT_WALL: CE OI is rapidly reversing');
  } else {
    const putOI = row.put_options?.market_data?.oi || 0;
    const putOIChange = row.put_options?.market_data?.oi_change || 0;
    const surrPutOI = surr.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0) / 4;
    
    if (surrPutOI === 0 || putOI < 1.5 * surrPutOI) return fail('FAILED_DOMINANT_WALL: PE OI is not 1.5x dominant');
    if (putOIChange < -0.05 * putOI) return fail('FAILED_DOMINANT_WALL: PE OI is rapidly reversing');
  }
  
  return pass();
}

export function rule9WallTestedTwice(setup: ProposedSetup, testCount: number): RuleResult {
  if (setup.setupType === 'OI_WALL_REJECTION' && testCount < 2) {
    return fail('FAILED_WALL_TESTS: Wall was not tested at least 2 times');
  }
  return pass();
}

export function rule10BreakoutConfirmation(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST') {
    if (!setup.c2 || !setup.c1 || !setup.c0) return fail('FAILED_BREAKOUT_CONF: Required candles missing');

    if (setup.direction === 'CALL') {
      if (!(setup.c2.close > setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not > level');
      if (!(setup.c0.close > setup.level)) return fail('FAILED_BREAKOUT_CONF: c0.close not confirming breakout');
      if (!(setup.c0.close >= setup.c0.open)) return fail('FAILED_BREAKOUT_CONF: c0 is not green');
    } else {
      if (!(setup.c2.close < setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not < level');
      if (!(setup.c0.close < setup.level)) return fail('FAILED_BREAKOUT_CONF: c0.close not confirming breakdown');
      if (!(setup.c0.close <= setup.c0.open)) return fail('FAILED_BREAKOUT_CONF: c0 is not red');
    }
  }
  return pass();
}

export function rule11RetestQuality(setup: ProposedSetup): RuleResult {
  if (['FAILED_RETEST', 'OPENING_TRAP'].includes(setup.setupType)) {
    if (setup.barsSinceRetest === undefined) return fail('FAILED_RETEST_QUALITY: Missing retest sequence data');
    
    if (setup.setupType === 'OPENING_TRAP' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 3)) {
      return fail('FAILED_RETEST_QUALITY: Opening trap retest must be within 1-3 candles');
    }
    
    if (setup.setupType === 'FAILED_RETEST' && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 4)) {
      return fail('FAILED_RETEST_QUALITY: Failed retest must be within 1-4 candles');
    }
  }
  return pass();
}

export function rule12ConfirmationCandle(setup: ProposedSetup, index: string): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  // Use a smaller, prompt-aligned confirmation threshold
  const minBody = index === 'NIFTY' ? 0.1 : 0.2; 
  if (isCall && c0.close <= c0.open + minBody) return fail('FAILED_CONFIRMATION_CANDLE: Candle is not confirming GREEN');
  if (!isCall && c0.close >= c0.open - minBody) return fail('FAILED_CONFIRMATION_CANDLE: Candle is not confirming RED');
  return pass();
}

export function rule13PremiumConfirmation(setup: ProposedSetup): RuleResult {
  const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) return fail('FAILED_PREMIUM_CONFIRMATION: Missing premium data');
  const [p1, p2, p3] = premiumSeriesLast3;
  
  if (p3 < p1 * 0.95) return fail('FAILED_PREMIUM_CONFIRMATION: Premium is clearly weakening');
  return pass();
}

export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  const spotMoveFromLevel = setup.spotMoveFromLevel;
  const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (spotMoveFromLevel === undefined) return fail('FAILED_MIXED_DIRECTION: Missing spot structure data');
  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) return fail('FAILED_MIXED_DIRECTION: Missing premium series data');
  
  const [p1, p2, p3] = premiumSeriesLast3;
  const premiumConfirming = p3 >= p1 * 0.95;
  
  if (setup.direction === 'CALL') {
    if (spotMoveFromLevel <= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bullish');
    if (!premiumConfirming) return fail('FAILED_MIXED_DIRECTION: CE Premium not confirming');
  } else {
    if (spotMoveFromLevel >= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bearish');
    if (!premiumConfirming) return fail('FAILED_MIXED_DIRECTION: PE Premium not confirming');
  }
  return pass();
}

export function rule15Overextension(setup: ProposedSetup, spotPrice: number): RuleResult {
  if (!setup.impulseRange) return pass(); // Can't check if missing, let rule19 complain if needed
  const distance = Math.abs(spotPrice - setup.level);
  if (distance > 1.5 * setup.impulseRange) {
    return fail('FAILED_OVEREXTENSION: Move from breakout level > 1.5x impulse candle range');
  }
  return pass();
}

export function rule16RoomToTarget(setup: ProposedSetup): RuleResult {
  if (!setup.target1 || !setup.stopLoss || !setup.level) return fail('FAILED_ROOM_TO_TARGET: Missing target, stopLoss, or level data');
  const risk = Math.abs(setup.level - setup.stopLoss);
  const reward1 = Math.abs(setup.target1 - setup.level);
  if (risk > 0 && (reward1 / risk) < 0.8) return fail('FAILED_ROOM_TO_TARGET: Target 1 is less than 0.8R');
  return pass();
}

export function rule17ChopFilter(ctx: ValidationContext): RuleResult {
  if (!ctx.nearestCeWallAbove || !ctx.nearestPeWallBelow) return pass();
  const distance = ctx.nearestCeWallAbove - ctx.nearestPeWallBelow;
  const threshold = ctx.index === 'NIFTY' ? 60 : 120;
  if (distance > 0 && distance <= threshold) {
    return fail('FAILED_CHOP_FILTER: Price is trapped between nearby CE and PE walls');
  }
  return pass();
}

export function rule18BrokenLevelReclaimedInvalidation(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const candles = ctx.candles1m;
  if (!candles || candles.length < 3) return pass(); // Insufficient to prove reclaim, but let setup be evaluated on its own merits
  
  let reclaimed = false;
  let breakoutIdx = -1;
  
  if (setup.direction === 'CALL') {
    for (let i = candles.length - 1; i >= Math.max(1, candles.length - 15); i--) {
      if (candles[i].close > setup.level && candles[i - 1].close <= setup.level) {
        breakoutIdx = i;
        break;
      }
    }
    
    if (breakoutIdx !== -1) {
      for (let j = breakoutIdx + 1; j < candles.length; j++) {
        if (candles[j].close < setup.level) {
          reclaimed = true;
          break;
        }
      }
    }
  } else {
    for (let i = candles.length - 1; i >= Math.max(1, candles.length - 15); i--) {
      if (candles[i].close < setup.level && candles[i - 1].close >= setup.level) {
        breakoutIdx = i;
        break;
      }
    }
    
    if (breakoutIdx !== -1) {
      for (let j = breakoutIdx + 1; j < candles.length; j++) {
        if (candles[j].close > setup.level) {
          reclaimed = true;
          break;
        }
      }
    }
  }
  
  if (reclaimed) {
    return fail('FAILED_RECLAIMED_LEVEL: Broken level was reclaimed by a closed candle');
  }
  return pass();
}

export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const spotMove = setup.spotMoveFromLevel;
  
  if (spotMove !== undefined) {
    if (isCall && spotMove < 0) return fail('FAILED_OVERALL_AGREEMENT: CALL signal but spot structure is bearish');
    if (!isCall && spotMove > 0) return fail('FAILED_OVERALL_AGREEMENT: PUT signal but spot structure is bullish');
  }

  const premiumLast3 = isCall ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  if (premiumLast3 && premiumLast3.length === 3) {
    const [p1, p2, p3] = premiumLast3;
    if (p3 < p1 * 0.9) return fail('FAILED_OVERALL_AGREEMENT: Premium series is moving against the intended direction');
  }
  
  if (setup.setupType === 'CONTINUATION_BREAKOUT' && !isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakout must be CALL');
  if (setup.setupType === 'CONTINUATION_BREAKDOWN' && isCall) return fail('FAILED_OVERALL_AGREEMENT: Breakdown must be PUT');
  
  if (['FAILED_RETEST', 'OPENING_TRAP'].includes(setup.setupType)) {
    if (setup.barsSinceRetest === undefined) return fail('FAILED_OVERALL_AGREEMENT: Missing retest sequence data');
  }

  if (setup.setupType === 'OI_WALL_REJECTION') {
     const testCount = ctx.sessState.wallTestCounts[setup.level] || 0;
     if (testCount < 2) return fail('FAILED_OVERALL_AGREEMENT: OI Wall Rejection requires at least 2 tests');
  }
  
  return pass();
}

export function runSetupValidation(ctx: ValidationContext, setup: ProposedSetup, validLevels: number[], testCount: number = 0): RuleResult {
  const checks = [
    rule2OpeningFilter(ctx.timeStr, setup),
    rule5MarketStructure(ctx.sessState, setup),
    rule6FailedLevel(ctx.sessState, setup),
    rule7ValidLevels(setup, validLevels),
    rule8DominantOIWall(ctx, setup),
    rule9WallTestedTwice(setup, testCount),
    rule10BreakoutConfirmation(setup),
    rule11RetestQuality(setup),
    rule12ConfirmationCandle(setup, ctx.index),
    rule13PremiumConfirmation(setup),
    rule14MixedDirection(setup),
    rule15Overextension(setup, ctx.spotPrice),
    rule16RoomToTarget(setup),
    rule17ChopFilter(ctx),
    rule18BrokenLevelReclaimedInvalidation(ctx, setup),
    rule19OverallAgreement(ctx, setup)
  ];
  for (const check of checks) {
    if (!check.passed) return check;
  }
  return pass();
}
`;

fs.writeFileSync('src/backend/validation-rules.ts', rulesContent);
