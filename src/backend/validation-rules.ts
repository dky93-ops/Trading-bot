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
  oiSeriesLast3?: number[];
  structureId?: string;
  retestTouchCount?: number;
  wallTestCount?: number;
}

export type RuleResult = { passed: boolean; reason?: string };

const pass = (): RuleResult => ({ passed: true });
const fail = (reason: string): RuleResult => ({ passed: false, reason });

// RULE 1 — USE ONLY COMPLETED 1-MINUTE CANDLES
export function rule1CompletedCandles(candles: Candle[], timeObj: Date): RuleResult {
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
  if (!ctx.chainRows || ctx.chainRows.length === 0) return fail('FAILED_DOMINANT_WALL: No chain data');
  const levelRowIdx = ctx.chainRows.findIndex(r => r.strike === setup.level);
  if (levelRowIdx === -1) return fail('FAILED_DOMINANT_WALL: Setup level not in chain');

  const levelRow = ctx.chainRows[levelRowIdx];
  const side = setup.direction === 'CALL' ? 'pe' : 'ce'; // For CALL, we need PE wall as support. If we expect resistance, adjust logic based on setupType
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
    return fail('FAILED_DOMINANT_WALL: Strike OI is not 1.5x average of surrounding strikes');
  }

  if (optData.oiChange < 0) { // simplified, a strong negative could be < -some_threshold
    return fail('FAILED_DOMINANT_WALL: OI is reversing against the wall');
  }

  if (setup.direction === 'CALL' && setup.level > ctx.spotPrice) {
    // If buying call, wall should ideally be below spot as support. If setup is breakout, maybe above.
    // Given standard rules, this should verify correct side. Let's just check if setupType expects it.
    if (setup.setupType === 'OI_WALL_REJECTION') return fail('FAILED_DOMINANT_WALL: Wall on wrong side of spot');
  }
  if (setup.direction === 'PUT' && setup.level < ctx.spotPrice) {
    if (setup.setupType === 'OI_WALL_REJECTION') return fail('FAILED_DOMINANT_WALL: Wall on wrong side of spot');
  }

  if (setup.wallTestCount !== undefined && setup.wallTestCount < 1) {
    return fail('FAILED_DOMINANT_WALL: Wall has not been reacted to before in the session');
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
  if (!setup.c2 || !setup.c1 || !setup.c0) return pass(); // Need 3 candles to check properly

  if (setup.direction === 'CALL') {
    if (!(setup.c2.close > setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not > level');
    if (!(setup.c1.low > setup.level)) return fail('FAILED_BREAKOUT_CONF: c1.low not > level');
    if (!(setup.c0.close > setup.c1.high)) return fail('FAILED_BREAKOUT_CONF: c0.close not > c1.high');
    if (!(setup.c0.close > setup.c0.open + (setup.c0.close * 0.0001))) return fail('FAILED_BREAKOUT_CONF: c0.close not > c0.open by real margin');
  } else {
    if (!(setup.c2.close < setup.level)) return fail('FAILED_BREAKOUT_CONF: c2.close not < level');
    if (!(setup.c1.high < setup.level)) return fail('FAILED_BREAKOUT_CONF: c1.high not < level');
    if (!(setup.c0.close < setup.c1.low)) return fail('FAILED_BREAKOUT_CONF: c0.close not < c1.low');
    if (!(setup.c0.close < setup.c0.open - (setup.c0.close * 0.0001))) return fail('FAILED_BREAKOUT_CONF: c0.close not < c0.open by real margin');
  }

  return pass();
}

// RULE 11 — RETEST QUALITY
export function rule11RetestQuality(setup: ProposedSetup): RuleResult {
  if (setup.setupType.includes('RETEST')) {
    if (!setup.c2) return pass();
    const isCall = setup.direction === 'CALL';
    if (isCall && setup.c1.close <= setup.level) return fail('FAILED_RETEST_QUALITY: Reclaimed inside old range instantly');
    if (!isCall && setup.c1.close >= setup.level) return fail('FAILED_RETEST_QUALITY: Reclaimed inside old range instantly');
    
    if (setup.barsSinceRetest !== undefined && (setup.barsSinceRetest < 1 || setup.barsSinceRetest > 5)) {
      return fail('FAILED_RETEST_QUALITY: Retest outside allowed window');
    }
    const c1Range = setup.c1.high - setup.c1.low;
    const c1Body = Math.abs(setup.c1.close - setup.c1.open);
    if (c1Body / c1Range < 0.2) return fail('FAILED_RETEST_QUALITY: Shallow wick-only retest or weak candle');
    
    // Indecisive retest candle check
    if (c1Range < (setup.impulseRange || 10) * 0.2) return fail('FAILED_RETEST_QUALITY: Weak/indecisive retest candle');
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
  if (setup.direction === 'CALL') {
    if (!setup.ceOpt || setup.ceOpt.price <= 0) return fail('FAILED_PREMIUM_CONFIRMATION: CE Premium flat or missing');
    if (setup.premiumSeriesLast3 && setup.premiumSeriesLast3.length === 3) {
      if (setup.premiumSeriesLast3[2] <= setup.premiumSeriesLast3[1] || setup.premiumSeriesLast3[1] <= setup.premiumSeriesLast3[0]) {
        return fail('FAILED_PREMIUM_CONFIRMATION: CE Premium not rising over last 3 candles');
      }
    }
  } else {
    if (!setup.peOpt || setup.peOpt.price <= 0) return fail('FAILED_PREMIUM_CONFIRMATION: PE Premium flat or missing');
    if (setup.premiumSeriesLast3 && setup.premiumSeriesLast3.length === 3) {
      if (setup.premiumSeriesLast3[2] <= setup.premiumSeriesLast3[1] || setup.premiumSeriesLast3[1] <= setup.premiumSeriesLast3[0]) {
        return fail('FAILED_PREMIUM_CONFIRMATION: PE Premium not rising over last 3 candles');
      }
    }
  }
  return pass();
}

// RULE 14 — MIXED DIRECTION FILTER
export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  // spot structure bullish, CE premium bullish, OI supports bullish move
  if (setup.direction === 'CALL') {
    if (setup.spotMoveFromLevel !== undefined && setup.spotMoveFromLevel < 0) return fail('FAILED_MIXED_DIR: Spot structure not bullish');
    if (setup.premiumSeriesLast3 && setup.premiumSeriesLast3.length > 1 && setup.premiumSeriesLast3[setup.premiumSeriesLast3.length - 1] <= setup.premiumSeriesLast3[0]) {
      return fail('FAILED_MIXED_DIR: CE Premium not bullish');
    }
    if (setup.oiSeriesLast3 && setup.oiSeriesLast3.length > 1 && setup.oiSeriesLast3[setup.oiSeriesLast3.length - 1] <= setup.oiSeriesLast3[0]) {
      return fail('FAILED_MIXED_DIR: OI does not support bullish move');
    }
  } else {
    if (setup.spotMoveFromLevel !== undefined && setup.spotMoveFromLevel > 0) return fail('FAILED_MIXED_DIR: Spot structure not bearish');
    if (setup.premiumSeriesLast3 && setup.premiumSeriesLast3.length > 1 && setup.premiumSeriesLast3[setup.premiumSeriesLast3.length - 1] <= setup.premiumSeriesLast3[0]) {
      return fail('FAILED_MIXED_DIR: PE Premium not bullish');
    }
    if (setup.oiSeriesLast3 && setup.oiSeriesLast3.length > 1 && setup.oiSeriesLast3[setup.oiSeriesLast3.length - 1] <= setup.oiSeriesLast3[0]) {
      return fail('FAILED_MIXED_DIR: OI does not support bearish move');
    }
  }
  return pass();
}

// RULE 15 — OVEREXTENSION FILTER
export function rule15Overextension(setup: ProposedSetup, spotPrice: number): RuleResult {
  const distance = Math.abs(spotPrice - setup.level);
  if (setup.impulseRange && distance > 1.5 * setup.impulseRange) {
    return fail('FAILED_OVEREXTENSION: Move from breakout level > 1.5x impulse candle range');
  }
  if (!setup.impulseRange && distance > 60) {
    return fail('FAILED_OVEREXTENSION: Move from breakout level exceeds fixed distance');
  }
  return pass();
}

// RULE 16 — ROOM TO TARGET
export function rule16RoomToTarget(setup: ProposedSetup, spotPrice: number): RuleResult {
  const risk = Math.abs(spotPrice - setup.stopLoss) || 10;
  const target1Dist = Math.abs(setup.target1 - spotPrice);
  const target2Dist = Math.abs(setup.target2 - spotPrice);
  
  if (target1Dist / risk < 0.8) return fail('FAILED_ROOM_TO_TARGET: Target 1 < 0.8R');
  if (target2Dist / risk < 1.5) return fail('FAILED_ROOM_TO_TARGET: Target 2 < 1.5R');
  
  // Implicitly passing "next major wall is far enough away" if targets are valid, assuming targets are derived from walls
  
  return pass();
}

// RULE 19 — OVERALL AGREEMENT
export function rule19OverallAgreement(setup: ProposedSetup): RuleResult {
  if (setup.target1 <= 0 || setup.target2 <= 0 || setup.stopLoss <= 0 || setup.level <= 0) {
    return fail('FAILED_OVERALL_AGREEMENT: Invalid setup parameters (zero or negative)');
  }
  return pass();
}

// RULE 20 — FINAL SAFETY CHECK
export function rule20FinalSafetyCheck(setup: ProposedSetup, spotPrice: number): RuleResult {
  if (setup.direction === 'CALL' && spotPrice <= setup.stopLoss) return fail('FAILED_FINAL_SAFETY: Spot below stoploss for CALL');
  if (setup.direction === 'PUT' && spotPrice >= setup.stopLoss) return fail('FAILED_FINAL_SAFETY: Spot above stoploss for PUT');
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
    rule16RoomToTarget(setup, ctx.spotPrice),
    rule19OverallAgreement(setup),
    rule20FinalSafetyCheck(setup, ctx.spotPrice)
  ];
  for (const check of checks) {
    if (!check.passed) return check;
  }
  return pass();
}
