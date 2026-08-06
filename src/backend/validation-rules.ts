import { Candle, Signal, StrategySessionState } from './types.js';

export interface ValidationContext {
  index: string;
  spotPrice: number;
  timeObj: Date;
  timeStr: string;
  activeSignals: Map<string, Signal>;
  sessState: StrategySessionState;
  candles1m: Candle[];
  chainRows: any[];
  nearestCEWallAbove: number;
  nearestPEWallBelow: number;
}

export interface ProposedSetup {
  direction: 'CALL' | 'PUT';
  level: number;
  setupType: string; // e.g. FAILED_RETEST, CONTINUATION_BREAKDOWN
  c0: Candle;
  c1: Candle;
  c2?: Candle;
  target1: number;
  target2: number;
  stopLoss: number;
  ceOpt?: any;
  peOpt?: any;
  barsSinceBreakout?: number;
  barsSinceRetest?: number;
  impulseRange?: number;
  spotMoveFromLevel?: number;
  premiumSeriesLast3?: number[];
  oppPremiumSeriesLast3?: number[];
  oiSeriesLast3?: number[];
  oppOiSeriesLast3?: number[];
  structureId?: string;
  retestTouchCount?: number;
  wallTestCount?: number;
}

export type RuleResult = { passed: boolean; reason?: string };

const pass = (): RuleResult => ({ passed: true });
const fail = (reason: string): RuleResult => ({ passed: false, reason });

// RULE 1 — USE ONLY COMPLETED 1-MINUTE CANDLES
export function rule1CompletedCandles(candles: Candle[], timeObj: Date): RuleResult {
  if (!candles || candles.length === 0) return fail('FAILED_COMPLETED_CANDLE: No candles available');
  const currentMinuteStart = Math.floor(timeObj.getTime() / 60000) * 60000;
  const hasIncomplete = candles.some(c => new Date(c.timestamp).getTime() >= currentMinuteStart);
  if (hasIncomplete) return fail('FAILED_COMPLETED_CANDLE: Contains incomplete live candles');
  return pass();
}

// RULE 2 — OPENING MARKET FILTER
export function rule2OpeningFilter(timeStr: string): RuleResult {
  if (timeStr >= '09:15' && timeStr < '09:30') return fail('FAILED_TIME_FILTER: 09:15 to 09:30 IST window');
  return pass();
}

// RULE 3 — ONE OPEN TRADE ONLY
export function rule3OneOpenTrade(activeSignals: Map<string, Signal>): RuleResult {
  if (activeSignals.size >= 1) return fail('FAILED_MAX_TRADES: A trade is already active');
  return pass();
}

// RULE 4 — POST EXIT COOLDOWN
export function rule4Cooldown(sessState: StrategySessionState, nowMs: number): RuleResult {
  if (sessState.lastTradeExitTime > 0 && (nowMs - sessState.lastTradeExitTime) < 120000) {
    return fail('FAILED_COOLDOWN: Under 2-minute post-trade cooldown');
  }
  return pass();
}

// RULE 17 — CHOP FILTER
export function rule17ChopFilter(ctx: ValidationContext): RuleResult {
  const distance = ctx.nearestCEWallAbove - ctx.nearestPEWallBelow;
  const threshold = ctx.index === 'NIFTY' ? 60 : 120;
  if (distance > 0 && distance <= threshold) {
    return fail('FAILED_CHOP_FILTER: Price is trapped between nearby CE and PE walls');
  }
  return pass();
}

// RULE 5 — ONE TRADE PER MARKET STRUCTURE
export function rule5MarketStructure(sessState: StrategySessionState, setup: ProposedSetup): RuleResult {
  if (setup.structureId && sessState.tradedStructures && sessState.tradedStructures.includes(setup.structureId)) {
    return fail(`FAILED_MARKET_STRUCTURE: Already traded structure ${setup.structureId} today`);
  }
  return pass();
}

// RULE 6 — SAME FAILED LEVEL BLOCK
export function rule6FailedLevel(sessState: StrategySessionState, setup: ProposedSetup): RuleResult {
  if (sessState.failedLevelsToday && sessState.failedLevelsToday.includes(setup.level)) {
    return fail(`FAILED_FAILED_LEVEL: Level ${setup.level} failed earlier today`);
  }
  if (sessState.lastFailedSetupLevel === setup.level) {
    return fail(`FAILED_FAILED_LEVEL: Level ${setup.level} failed earlier today`);
  }
  if (setup.structureId && sessState.failedStructuresToday && sessState.failedStructuresToday.includes(setup.structureId)) {
    return fail(`FAILED_FAILED_STRUCTURE: Structure ${setup.structureId} failed earlier today`);
  }
  return pass();
}

// RULE 7 — VALID LEVELS ONLY
export function rule7ValidLevels(setup: ProposedSetup, validLevels: number[]): RuleResult {
  if (!validLevels.includes(setup.level)) {
    return fail('FAILED_VALID_LEVEL: Level is not a recognized ORH/ORL/PDH/PDL/Wall');
  }
  return pass();
}

// RULE 8 — DOMINANT OI WALL
export function rule8DominantOIWall(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (!ctx.chainRows || ctx.chainRows.length === 0) return fail('FAILED_OI_WALL: No chain data');
  const levelRowIdx = ctx.chainRows.findIndex(r => r.strike === setup.level);
  if (levelRowIdx === -1) return fail('FAILED_OI_WALL: Setup level not in chain');

  const levelRow = ctx.chainRows[levelRowIdx];
  let side: 'pe' | 'ce';

  if (setup.setupType === 'OI_WALL_REJECTION') {
    if (setup.direction === 'CALL') {
      side = 'pe';
      if (setup.level >= ctx.spotPrice) return fail('FAILED_OI_WALL: PE Wall Rejection level must be below spot');
    } else if (setup.direction === 'PUT') {
      side = 'ce';
      if (setup.level <= ctx.spotPrice) return fail('FAILED_OI_WALL: CE Wall Rejection level must be above spot');
    } else {
      return fail('FAILED_OI_WALL: Invalid direction');
    }
  } else if (setup.setupType === 'OPENING_TRAP') {
    if (setup.direction === 'CALL') {
      side = 'ce';
      if (setup.level >= ctx.spotPrice) return fail('FAILED_OI_WALL: Opening Trap level (resistance) must be below spot after breakout');
    } else if (setup.direction === 'PUT') {
      side = 'pe';
      if (setup.level <= ctx.spotPrice) return fail('FAILED_OI_WALL: Opening Trap level (support) must be above spot after breakdown');
    } else {
      return fail('FAILED_OI_WALL: Invalid direction');
    }
  } else if (setup.setupType === 'CONTINUATION_BREAKOUT' || (setup.setupType === 'FAILED_RETEST' && setup.direction === 'CALL')) {
    side = 'ce';
    if (setup.level >= ctx.spotPrice) return fail('FAILED_OI_WALL: Breakout/Retest level must be below spot');
  } else if (setup.setupType === 'CONTINUATION_BREAKDOWN' || (setup.setupType === 'FAILED_RETEST' && setup.direction === 'PUT')) {
    side = 'pe';
    if (setup.level <= ctx.spotPrice) return fail('FAILED_OI_WALL: Breakdown/Retest level must be above spot');
  } else {
    return fail('FAILED_OI_WALL: Unknown setup family contextual wall');
  }

  const optData = side === 'pe' ? levelRow.pe : levelRow.ce;

  let sumOI = 0;
  let count = 0;
  for (let i = Math.max(0, levelRowIdx - 2); i <= Math.min(ctx.chainRows.length - 1, levelRowIdx + 2); i++) {
    if (i === levelRowIdx) continue;
    const r = ctx.chainRows[i];
    sumOI += side === 'pe' ? r.pe.oi : r.ce.oi;
    count++;
  }
  const avgOI = count > 0 ? sumOI / count : 0;

  if (optData.oi < 1.5 * avgOI) {
    return fail('FAILED_OI_WALL: Strike OI is not 1.5x average of surrounding strikes');
  }

  if (optData.oiChange < 0) { 
    return fail('FAILED_OI_WALL: OI is rapidly reversing against the wall');
  }

  if (setup.setupType === 'OI_WALL_REJECTION') {
    if (setup.wallTestCount === undefined || setup.wallTestCount < 2) {
      return fail('FAILED_OI_WALL: Wall must have prior spot reaction (>= 2 tests) in current session');
    }
  }

  return pass();
}

// RULE 9 — WALL MUST BE TESTED TWICE
export function rule9WallTestedTwice(setup: ProposedSetup, testCount: number): RuleResult {
  if (setup.setupType === 'OI_WALL_REJECTION' && testCount < 2) {
    return fail('FAILED_WALL_TESTS: Wall was not tested at least 2 times');
  }
  return pass();
}

// RULE 10 — BREAKOUT CONFIRMATION
export function rule10BreakoutConfirmation(setup: ProposedSetup): RuleResult {
  // If setup inherently requires a breakout sequence, enforce it
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST') {
    if (!setup.c2 || !setup.c1 || !setup.c0) return fail('FAILED_BREAKOUT_CONF: Required candles missing');

    if (setup.direction === 'CALL') {
      if (!(setup.c2.close > setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not > level');
      // For FAILED_RETEST, c1.low <= level. For CONTINUATION, c1.low > level or similar, but strategy logic handles exact positioning. 
      // Just ensure confirmation candle confirms direction.
      if (!(setup.c0.close > Math.max(setup.c1.high, setup.level))) return fail('FAILED_BREAKOUT_CONF: c0.close not confirming breakout');
      if (!(setup.c0.close > setup.c0.open + (setup.c0.close * 0.0001))) return fail('FAILED_BREAKOUT_CONF: c0.close not > c0.open by real margin');
    } else {
      if (!(setup.c2.close < setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not < level');
      if (!(setup.c0.close < Math.min(setup.c1.low, setup.level))) return fail('FAILED_BREAKOUT_CONF: c0.close not confirming breakdown');
      if (!(setup.c0.close < setup.c0.open - (setup.c0.close * 0.0001))) return fail('FAILED_BREAKOUT_CONF: c0.close not < c0.open by real margin');
    }
  } else if (setup.setupType === 'OPENING_TRAP') {
    if (!setup.c1 || !setup.c0) return fail('FAILED_BREAKOUT_CONF: Required candles missing');
    if (setup.direction === 'CALL') {
      if (!(setup.c1.close > setup.level)) return fail('FAILED_BREAKOUT_CONF: c1.close not > level');
      if (!(setup.c0.close > setup.c1.high)) return fail('FAILED_BREAKOUT_CONF: c0.close not > c1.high');
    } else {
      if (!(setup.c1.close < setup.level)) return fail('FAILED_BREAKOUT_CONF: c1.close not < level');
      if (!(setup.c0.close < setup.c1.low)) return fail('FAILED_BREAKOUT_CONF: c0.close not < c1.low');
    }
  }

  return pass();
}

// RULE 11 — RETEST QUALITY
export function rule11RetestQuality(setup: ProposedSetup): RuleResult {
  if (setup.setupType.includes('RETEST')) {
    if (!setup.c2) return fail('FAILED_RETEST_QUALITY: Missing pre-retest candle (c2)');
    const isCall = setup.direction === 'CALL';
    if (isCall && setup.c1.close <= setup.level) return fail('FAILED_RETEST_QUALITY: Reclaimed inside old range instantly');
    if (!isCall && setup.c1.close >= setup.level) return fail('FAILED_RETEST_QUALITY: Reclaimed inside old range instantly');
    
    if (setup.barsSinceRetest === undefined || setup.barsSinceRetest < 1 || setup.barsSinceRetest > 5) {
      return fail('FAILED_RETEST_QUALITY: Retest outside allowed window or missing data');
    }
    const c1Range = setup.c1.high - setup.c1.low;
    const c1Body = Math.abs(setup.c1.close - setup.c1.open);
    if (c1Range === 0) return fail('FAILED_RETEST_QUALITY: Zero range retest candle');
    if (c1Body / c1Range < 0.2) return fail('FAILED_RETEST_QUALITY: Shallow wick-only retest or weak candle');
    
    // Indecisive retest candle check
    if (!setup.impulseRange) return fail('FAILED_RETEST_QUALITY: Missing impulse range for comparison');
    if (c1Range < setup.impulseRange * 0.2) return fail('FAILED_RETEST_QUALITY: Weak/indecisive retest candle');
  }
  return pass();
}

// RULE 12 — CONFIRMATION CANDLE
export function rule12ConfirmationCandle(setup: ProposedSetup, index: string): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  const buffer = index === 'NIFTY' ? 2 : 5;
  if (isCall && c0.close <= c0.open + buffer) return fail('FAILED_CONFIRMATION_CANDLE: Candle is not solidly GREEN');
  if (!isCall && c0.close >= c0.open - buffer) return fail('FAILED_CONFIRMATION_CANDLE: Candle is not solidly RED');
  return pass();
}

// RULE 13 — PREMIUM CONFIRMATION
export function rule13PremiumConfirmation(setup: ProposedSetup): RuleResult {
  const { premiumSeriesLast3, oppPremiumSeriesLast3 } = setup;

  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) {
    return fail('FAILED_PREMIUM_CONFIRMATION: Missing 3 closed premium points');
  }

  const [p1, p2, p3] = premiumSeriesLast3;

  if (p3 <= p2 || p2 <= p1) {
    return fail('FAILED_PREMIUM_CONFIRMATION: Premium is flat or falling');
  }

  const premiumExpansion = p3 - p1;

  if (!oppPremiumSeriesLast3 || oppPremiumSeriesLast3.length < 3) {
    return fail('FAILED_PREMIUM_CONFIRMATION: Missing opposite premium data for comparison');
  }

  const [op1, op2, op3] = oppPremiumSeriesLast3;
  const oppPremiumExpansion = op3 - op1;
  
  if (oppPremiumExpansion > premiumExpansion) {
    return fail('FAILED_PREMIUM_CONFIRMATION: Opposite side premium expansion is stronger');
  }

  return pass();
}

// RULE 14 — MIXED DIRECTION FILTER
export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  const { spotMoveFromLevel, premiumSeriesLast3 } = setup;

  if (spotMoveFromLevel === undefined) {
    return fail('FAILED_MIXED_DIRECTION: Missing spot structure data');
  }
  
  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3) {
    return fail('FAILED_MIXED_DIRECTION: Missing premium series data');
  }
  
  const [p1, p2, p3] = premiumSeriesLast3;
  const premiumBullish = p3 > p2 && p2 > p1;

  if (setup.direction === 'CALL') {
    if (spotMoveFromLevel <= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bullish');
    if (!premiumBullish) return fail('FAILED_MIXED_DIRECTION: CE Premium not strictly bullish');
  } else {
    if (spotMoveFromLevel >= 0) return fail('FAILED_MIXED_DIRECTION: Spot structure not bearish');
    if (!premiumBullish) return fail('FAILED_MIXED_DIRECTION: PE Premium not strictly bullish');
  }

  return pass();
}

// RULE 15 — OVEREXTENSION FILTER
export function rule15Overextension(setup: ProposedSetup, spotPrice: number): RuleResult {
  if (!setup.impulseRange) {
    return fail('FAILED_OVEREXTENSION: Impulse range or volatility data is missing');
  }
  const distance = Math.abs(spotPrice - setup.level);
  if (distance > 1.5 * setup.impulseRange) {
    return fail('FAILED_OVEREXTENSION: Move from breakout level > 1.5x impulse candle range');
  }
  return pass();
}

// RULE 16 — ROOM TO TARGET
export function rule16RoomToTarget(setup: ProposedSetup, ctx: ValidationContext): RuleResult {
  const risk = Math.max(10, Math.abs(ctx.spotPrice - setup.stopLoss));
  const sess = ctx.sessState as any;
  
  if (setup.direction === 'CALL') {
    const candidates = [
      ctx.nearestCEWallAbove,
      sess.sessionHigh,
      sess.previousDayHigh,
      sess.openingRangeHigh
    ].filter(l => l !== undefined && l > ctx.spotPrice);

    if (candidates.length === 0) return fail('FAILED_ROOM_TO_TARGET: No valid resistance obstacle found');
    const nearestObstacle = Math.min(...candidates);
    const room = nearestObstacle - ctx.spotPrice;
    
    if (room < 0.8 * risk) return fail('FAILED_ROOM_TO_TARGET: Room to nearest resistance < 0.8R');
    if (setup.setupType.includes('CONTINUATION') && room < 1.5 * risk) {
      return fail('FAILED_ROOM_TO_TARGET: Room to nearest resistance < 1.5R for continuation setup');
    }
  } else {
    const candidates = [
      ctx.nearestPEWallBelow,
      sess.sessionLow,
      sess.previousDayLow,
      sess.openingRangeLow
    ].filter(l => l !== undefined && l > 0 && l < ctx.spotPrice);

    if (candidates.length === 0) return fail('FAILED_ROOM_TO_TARGET: No valid support obstacle found');
    const nearestObstacle = Math.max(...candidates);
    const room = ctx.spotPrice - nearestObstacle;
    
    if (room < 0.8 * risk) return fail('FAILED_ROOM_TO_TARGET: Room to nearest support < 0.8R');
    if (setup.setupType.includes('CONTINUATION') && room < 1.5 * risk) {
      return fail('FAILED_ROOM_TO_TARGET: Room to nearest support < 1.5R for continuation setup');
    }
  }
  
  return pass();
}

// RULE 18 — BROKEN LEVEL RECLAIMED INVALIDATION
export function rule18BrokenLevelReclaimedInvalidation(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const candles = ctx.candles1m;
  if (!candles || candles.length < 3) return fail('FAILED_RECLAIMED_LEVEL: Insufficient candles to determine reclaim');

  let reclaimed = false;

  if (setup.direction === 'CALL') {
    if (setup.c0.close < setup.level) reclaimed = true;
    if (setup.c1.close < setup.level && (setup.c2 && setup.c2.close > setup.level)) reclaimed = true;
    
    let breakoutIdx = -1;
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
    } else if (['FAILED_RETEST', 'CONTINUATION_BREAKOUT', 'OPENING_TRAP'].includes(setup.setupType)) {
      reclaimed = true;
    }
  } else {
    if (setup.c0.close > setup.level) reclaimed = true;
    if (setup.c1.close > setup.level && (setup.c2 && setup.c2.close < setup.level)) reclaimed = true;
    
    let breakoutIdx = -1;
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
    } else if (['FAILED_RETEST', 'CONTINUATION_BREAKDOWN', 'OPENING_TRAP'].includes(setup.setupType)) {
      reclaimed = true;
    }
  }

  if (reclaimed) {
    return fail('FAILED_RECLAIMED_LEVEL: Broken level was reclaimed by a closed candle');
  }

  return pass();
}

// RULE 19 — OVERALL AGREEMENT
export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (!setup.level || setup.level <= 0) return fail('FAILED_OVERALL_AGREEMENT: Invalid level');
  if (setup.direction !== 'CALL' && setup.direction !== 'PUT') return fail('FAILED_OVERALL_AGREEMENT: Invalid direction');

  if (setup.direction === 'CALL' && ctx.spotPrice < setup.level) return fail('FAILED_OVERALL_AGREEMENT: Level no longer intact (spot below support)');
  if (setup.direction === 'PUT' && ctx.spotPrice > setup.level) return fail('FAILED_OVERALL_AGREEMENT: Level no longer intact (spot above resistance)');

  if (!setup.premiumSeriesLast3 || setup.premiumSeriesLast3.length < 3) return fail('FAILED_OVERALL_AGREEMENT: Premium data missing');
  if (!setup.oiSeriesLast3 || setup.oiSeriesLast3.length < 3) return fail('FAILED_OVERALL_AGREEMENT: OI data missing');
  if (!setup.oppOiSeriesLast3 || setup.oppOiSeriesLast3.length < 3) return fail('FAILED_OVERALL_AGREEMENT: Opposite OI data missing');

  const [p1, p2, p3] = setup.premiumSeriesLast3;
  if (!(p3 > p2 && p2 > p1)) return fail('FAILED_OVERALL_AGREEMENT: Premium not strictly rising');

  const [o1, o2, o3] = setup.oiSeriesLast3;
  const oiFalling = o3 < o2 && o2 < o1;
  const [oo1, oo2, oo3] = setup.oppOiSeriesLast3;
  const oppOiRising = oo3 > oo2 && oo2 > oo1;

  if (setup.setupType === 'FAILED_RETEST') {
    if (!setup.c1 || !setup.c2 || !setup.c0) return fail('FAILED_OVERALL_AGREEMENT: Missing FAILED_RETEST structure candles');
    if (setup.barsSinceRetest === undefined || setup.barsSinceRetest < 1 || setup.barsSinceRetest > 5) return fail('FAILED_OVERALL_AGREEMENT: Missing or weak retest structure');
    
    if (setup.direction === 'CALL') {
      if (setup.c1.low > setup.level) return fail('FAILED_OVERALL_AGREEMENT: FAILED_RETEST CALL did not test the broken level');
      if (setup.c2.close < setup.level) return fail('FAILED_OVERALL_AGREEMENT: FAILED_RETEST CALL broken level not established');
      if (!oiFalling) return fail('FAILED_OVERALL_AGREEMENT: CE OI must be falling for CALL FAILED_RETEST');
    } else {
      if (setup.c1.high < setup.level) return fail('FAILED_OVERALL_AGREEMENT: FAILED_RETEST PUT did not test the broken level');
      if (setup.c2.close > setup.level) return fail('FAILED_OVERALL_AGREEMENT: FAILED_RETEST PUT broken level not established');
      if (!oiFalling) return fail('FAILED_OVERALL_AGREEMENT: PE OI must be falling for PUT FAILED_RETEST');
    }
  } else if (setup.setupType === 'CONTINUATION_BREAKDOWN') {
    if (setup.direction !== 'PUT') return fail('FAILED_OVERALL_AGREEMENT: CONTINUATION_BREAKDOWN must be PUT');
    if (!setup.c1 || !setup.c2 || !setup.c0) return fail('FAILED_OVERALL_AGREEMENT: Missing CONTINUATION_BREAKDOWN structure candles');
    if (setup.barsSinceBreakout === undefined || setup.barsSinceBreakout < 1) return fail('FAILED_OVERALL_AGREEMENT: Pause below level not confirmed');
    if (setup.c1.close > setup.level) return fail('FAILED_OVERALL_AGREEMENT: Pause must be below level for CONTINUATION_BREAKDOWN');
    if (!oiFalling) return fail('FAILED_OVERALL_AGREEMENT: PE OI must be falling for PUT CONTINUATION_BREAKDOWN');
  } else if (setup.setupType === 'CONTINUATION_BREAKOUT') {
    if (setup.direction !== 'CALL') return fail('FAILED_OVERALL_AGREEMENT: CONTINUATION_BREAKOUT must be CALL');
    if (!setup.c1 || !setup.c2 || !setup.c0) return fail('FAILED_OVERALL_AGREEMENT: Missing CONTINUATION_BREAKOUT structure candles');
    if (setup.barsSinceBreakout === undefined || setup.barsSinceBreakout < 1) return fail('FAILED_OVERALL_AGREEMENT: Pause above level not confirmed');
    if (setup.c1.close < setup.level) return fail('FAILED_OVERALL_AGREEMENT: Pause must be above level for CONTINUATION_BREAKOUT');
    if (!oiFalling) return fail('FAILED_OVERALL_AGREEMENT: CE OI must be falling for CALL CONTINUATION_BREAKOUT');
  } else if (setup.setupType === 'OPENING_TRAP') {
    if (!setup.c1 || !setup.c0) return fail('FAILED_OVERALL_AGREEMENT: Missing OPENING_TRAP structure candles');
    if (setup.direction === 'CALL') {
      if (setup.c1.low > setup.level) return fail('FAILED_OVERALL_AGREEMENT: OPENING_TRAP CALL did not retest opening range high');
      if (!oiFalling) return fail('FAILED_OVERALL_AGREEMENT: CE OI must be falling for CALL OPENING_TRAP');
    } else {
      if (setup.c1.high < setup.level) return fail('FAILED_OVERALL_AGREEMENT: OPENING_TRAP PUT did not retest opening range low');
      if (!oiFalling) return fail('FAILED_OVERALL_AGREEMENT: PE OI must be falling for PUT OPENING_TRAP');
    }
  } else if (setup.setupType === 'OI_WALL_REJECTION') {
    if (!setup.c0) return fail('FAILED_OVERALL_AGREEMENT: Missing OI_WALL_REJECTION confirmation candle');
    if (setup.wallTestCount === undefined || setup.wallTestCount < 2) return fail('FAILED_OVERALL_AGREEMENT: Wall rejection requires multiple prior tests');
    
    if (setup.direction === 'CALL') {
      if (!oppOiRising) return fail('FAILED_OVERALL_AGREEMENT: PE OI must be rising for CALL OI_WALL_REJECTION');
      if (setup.c0.low > setup.level) return fail('FAILED_OVERALL_AGREEMENT: CALL OI_WALL_REJECTION did not reject near the support wall');
    } else {
      if (!oppOiRising) return fail('FAILED_OVERALL_AGREEMENT: CE OI must be rising for PUT OI_WALL_REJECTION');
      if (setup.c0.high < setup.level) return fail('FAILED_OVERALL_AGREEMENT: PUT OI_WALL_REJECTION did not reject near the resistance wall');
    }
  } else {
    return fail('FAILED_OVERALL_AGREEMENT: Unknown setup family');
  }

  if (!setup.target1 || setup.target1 <= 0) return fail('FAILED_OVERALL_AGREEMENT: Invalid target1');
  if (!setup.stopLoss || setup.stopLoss <= 0) return fail('FAILED_OVERALL_AGREEMENT: Invalid stopLoss');

  const risk = Math.max(1, Math.abs(ctx.spotPrice - setup.stopLoss));
  const target1Dist = Math.abs(setup.target1 - ctx.spotPrice);
  if (target1Dist / risk < 0.8) {
    return fail('FAILED_OVERALL_AGREEMENT: Reward/risk is weak (< 0.8R)');
  }

  const roomResult = rule16RoomToTarget(setup, ctx);
  if (!roomResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${roomResult.reason}`);

  const confResult = rule12ConfirmationCandle(setup, ctx.index);
  if (!confResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${confResult.reason}`);

  const breakResult = rule10BreakoutConfirmation(setup);
  if (!breakResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${breakResult.reason}`);
  
  const retestResult = rule11RetestQuality(setup);
  if (!retestResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${retestResult.reason}`);

  const mixedDirResult = rule14MixedDirection(setup);
  if (!mixedDirResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${mixedDirResult.reason}`);

  const overextResult = rule15Overextension(setup, ctx.spotPrice);
  if (!overextResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${overextResult.reason}`);

  const chopResult = rule17ChopFilter(ctx);
  if (!chopResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${chopResult.reason}`);

  const reclaimResult = rule18BrokenLevelReclaimedInvalidation(ctx, setup);
  if (!reclaimResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${reclaimResult.reason}`);

  const reuseResult = rule6FailedLevel(ctx.sessState, setup);
  if (!reuseResult.passed) return fail(`FAILED_OVERALL_AGREEMENT: ${reuseResult.reason}`);

  return pass();
}

// RULE 20 — FINAL SAFETY CHECK
export function rule20FinalSafetyCheck(
  ctx: ValidationContext,
  setup: ProposedSetup, 
  validLevels: number[],
  testCount: number
): RuleResult {
  const checks = [
    rule1CompletedCandles(ctx.candles1m, ctx.timeObj),
    rule2OpeningFilter(ctx.timeStr),
    rule3OneOpenTrade(ctx.activeSignals),
    rule4Cooldown(ctx.sessState, ctx.timeObj.getTime()),
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
    rule16RoomToTarget(setup, ctx),
    rule17ChopFilter(ctx),
    rule18BrokenLevelReclaimedInvalidation(ctx, setup),
    rule19OverallAgreement(ctx, setup)
  ];
  for (const check of checks) {
    if (!check.passed) return fail(`FAILED_FINAL_SAFETY_CHECK: ${check.reason}`);
  }

  return pass();
}

export function runGlobalPreChecks(ctx: ValidationContext): RuleResult {
  const checks = [
    rule1CompletedCandles(ctx.candles1m, ctx.timeObj),
    rule2OpeningFilter(ctx.timeStr),
    rule3OneOpenTrade(ctx.activeSignals),
    rule4Cooldown(ctx.sessState, ctx.timeObj.getTime()),
    rule17ChopFilter(ctx)
  ];
  for (const check of checks) {
    if (!check.passed) return check;
  }
  return pass();
}

export function runSetupValidation(ctx: ValidationContext, setup: ProposedSetup, validLevels: number[], testCount: number = 0): RuleResult {
  const checks = [
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
    rule16RoomToTarget(setup, ctx),
    rule18BrokenLevelReclaimedInvalidation(ctx, setup),
    rule19OverallAgreement(ctx, setup),
    rule20FinalSafetyCheck(ctx, setup, validLevels, testCount)
  ];
  for (const check of checks) {
    if (!check.passed) return check;
  }
  return pass();
}
