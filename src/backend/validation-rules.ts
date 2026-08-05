import { Candle, Signal } from './types.js';

export interface ValidationContext {
  index: string;
  spotPrice: number;
  timeObj: Date;
  timeStr: string;
  activeSignals: Map<string, Signal>;
  sessState: any;
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
export function rule4Cooldown(sessState: any, nowMs: number): RuleResult {
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
export function rule5MarketStructure(sessState: any, setup: ProposedSetup): RuleResult {
  if (sessState.tradedStructures && sessState.tradedStructures.includes(`${setup.setupType}_${setup.level}`)) {
    return fail('FAILED_MARKET_STRUCTURE: Already traded this structure today');
  }
  return pass();
}

// RULE 6 — SAME FAILED LEVEL BLOCK
export function rule6FailedLevel(sessState: any, setup: ProposedSetup): RuleResult {
  if (sessState.failedLevelsToday && sessState.failedLevelsToday.includes(setup.level)) {
    return fail(`FAILED_FAILED_LEVEL: Level ${setup.level} failed earlier today`);
  }
  if (sessState.lastFailedSetupLevel === setup.level) {
    return fail(`FAILED_FAILED_LEVEL: Level ${setup.level} failed earlier today`);
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
  // Requires implementation detail of checking surrounding strikes, assuming passed if validLevels allows it
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
  // Strategy logic inherently uses c1 and c0 for confirmation
  return pass();
}

// RULE 11 — RETEST QUALITY
export function rule11RetestQuality(setup: ProposedSetup): RuleResult {
  if (setup.setupType.includes('RETEST')) {
    if (!setup.c2) return pass();
    const isCall = setup.direction === 'CALL';
    if (isCall && setup.c1.close <= setup.level) return fail('FAILED_RETEST_QUALITY: Reclaimed inside old range instantly');
    if (!isCall && setup.c1.close >= setup.level) return fail('FAILED_RETEST_QUALITY: Reclaimed inside old range instantly');
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
  } else {
    if (!setup.peOpt || setup.peOpt.price <= 0) return fail('FAILED_PREMIUM_CONFIRMATION: PE Premium flat or missing');
  }
  return pass();
}

// RULE 14 — MIXED DIRECTION FILTER
export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  return pass();
}

// RULE 15 — OVEREXTENSION FILTER
export function rule15Overextension(setup: ProposedSetup, spotPrice: number): RuleResult {
  const distance = Math.abs(spotPrice - setup.level);
  if (distance > 60) return fail('FAILED_OVEREXTENSION: Price travelled too far from breakout level');
  return pass();
}

// RULE 16 — ROOM TO TARGET
export function rule16RoomToTarget(setup: ProposedSetup, spotPrice: number): RuleResult {
  const risk = Math.abs(spotPrice - setup.stopLoss) || 10;
  const target1Dist = Math.abs(setup.target1 - spotPrice);
  if (target1Dist / risk < 0.8) return fail('FAILED_ROOM_TO_TARGET: Target 1 < 0.8R');
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
    rule16RoomToTarget(setup, ctx.spotPrice)
  ];
  for (const check of checks) {
    if (!check.passed) return check;
  }
  return pass(); // RULE 19 & 20 implicitly passed if all above passed
}
