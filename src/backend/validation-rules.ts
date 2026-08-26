
import { StrategySessionState, Candle, InternalSignal } from './types.js';
import { computeATR, computeSMA, computeEMA, computeVWAP } from './technical-indicators';

export interface ProposedSetup {
  direction: 'CALL' | 'PUT';
  level: number;
  setupType: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION';
  c0: Candle;
  c1: Candle;
  c2?: Candle;
  target1: number;
  target2: number;
  stopLoss: number;
  ceOpt?: any;
  peOpt?: any;
  structureId?: string;

  breakCandleIndex?: number;
  retestCandleIndex?: number;
  confirmationCandleIndex?: number;

  barsSinceBreakout?: number;
  barsSinceRetest?: number;

  premiumAtBreak?: number;
  premiumAtRetestLow?: number;
  premiumAtConfirmation?: number;

  wallOIAtReference?: number;
  wallOIAtCurrent?: number;
  wallOIWeakeningPercent?: number;
  wallNegativeOIConsecutive?: number;

  wallTestCount?: number;
  wallLastTestCandleTimestamp?: string;

  hasSessionReaction?: boolean;
  hasTwoDistinctWallTests?: boolean;

  confirmationCandleGreen?: boolean;
  confirmationCandleRed?: boolean;

  continuationPauseValid?: boolean;

  firstImpulseRange?: number;
  moveFromBreakoutLevel?: number;
  spotMoveFromLevel?: number;

  spotSeriesLast3?: number[];
  callPremiumSeriesLast3?: number[];
  putPremiumSeriesLast3?: number[];
  [key: string]: any;
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
  settings?: any;
}

export interface RuleResult {
  passed: boolean;
  reason?: string;
}

export const pass = (): RuleResult => ({ passed: true });
export const fail = (reason: string): RuleResult => ({ passed: false, reason });

// GLOBAL PRECHECKS

export function rule20MarketFilters(
  ctx: ValidationContext,
  setup: ProposedSetup
): RuleResult {
  if (ctx.timeStr >= '15:00') {
    return fail('FAILED_TIME_FILTER: NO_NEW_TRADE at or after 15:00 IST');
  }
  const opt = setup.direction === 'CALL'
    ? setup.ceOpt
    : setup.peOpt;
  if (!opt || Number(opt.price || 0) <= 0) {
    return fail('FAILED_LIQUIDITY: Selected option LTP unavailable');
  }
  const bid = Number(opt.bidPrice || 0);
  const ask = Number(opt.askPrice || 0);
  const ltp = Number(opt.price);
  if (bid > 0 && ask > 0 && ask >= bid) {
    const spread = ((ask - bid) / ltp) * 100;
    const maxSpread = ctx.timeStr >= '14:00' ? 1.5 : 3.0;
    if (spread > maxSpread) {
      return fail(
        `FAILED_LIQUIDITY: Spread ${spread.toFixed(3)}% > ${maxSpread}%`
      );
    }
    setup.spreadPercent = spread;
  } else {
    // Deterministic proxy when bid/ask is unavailable.
    const s = setup.direction === 'CALL'
      ? setup.callPremiumSeriesLast3
      : setup.putPremiumSeriesLast3;
    if (!s || s.length < 3 || s.some(v => !Number.isFinite(v) || v <= 0)) {
      return fail(
        'FAILED_LIQUIDITY: Bid/ask unavailable and 3 valid premium observations unavailable'
      );
    }
    const hi = Math.max(...s);
    const lo = Math.min(...s);
    const avg = s.reduce((a,b) => a+b, 0) / s.length;
    if (avg <= 0 || ((hi - lo) / avg) > 0.10) {
      return fail(
        'FAILED_LIQUIDITY: Premium stability proxy exceeded 10% dispersion'
      );
    }
    setup.spreadPercent = 1.5;
  }
  return pass();
}

export function runGlobalPreChecks(ctx: ValidationContext): RuleResult {
  const { timeStr, activeSignals, sessState, candles1m, timeObj } = ctx;
  
  if (timeStr < '09:15') return fail('FAILED_TIME_FILTER: Pre-market');
  if (timeStr >= '15:30') return fail('FAILED_TIME_FILTER: Post-market');
  if (candles1m.length === 0) return fail('FAILED_COMPLETED_CANDLE: No candles available');
  
  if (activeSignals && activeSignals.size >= 1) return fail('FAILED_MAX_TRADES: A trade is already active');
  
  if (sessState.lastTradeExitTime > 0 && (timeObj.getTime() - sessState.lastTradeExitTime) < 120000) {
    return fail('FAILED_COOLDOWN: Under 2-minute post-trade cooldown');
  }
  
  
  return pass();
}

// SETUP VALIDATION
export function rule2OpeningFilter(timeStr: string, setup: ProposedSetup): RuleResult {
  if (timeStr < '09:20') {
    // Pre-09:20 IST: Only allow if the setup is exceptionally clean and already fully confirmed by all other hard rules.
    // The prompt basically means this is an extra layer. 
    // We let it pass here, the engine's hard rules must be very clean.
    // If confirmation sequence isn't fully established, we reject.
    if (!setup.c0 || !setup.c1 || !setup.c2) return fail('FAILED_OPENING_FILTER: Pre-09:20 requires exceptional clarity and full confirmation');
  } else if (timeStr < '09:30') {
    if (!setup.c0 || !setup.c1) return fail('FAILED_OPENING_FILTER: 09:20-09:30 requires genuinely strong fully confirmed setup');
  }
  
  return pass();
}

export function rule5MarketStructure(sessState: StrategySessionState, setup: ProposedSetup): RuleResult {
  if (setup.structureId && sessState.failedStructuresToday && sessState.failedStructuresToday.includes(setup.structureId)) {
    return fail('FAILED_MARKET_STRUCTURE: Structure already failed today');
  }
  
  return pass();
}

export function rule6FailedLevel(sessState: StrategySessionState, setup: ProposedSetup): RuleResult {
  if (setup.level && sessState.failedLevelsToday && sessState.failedLevelsToday.includes(setup.level)) {
    return fail('FAILED_LEVEL: Level has already failed today');
  }
  
  return pass();
}

export function rule7ValidLevels(setup: ProposedSetup, validLevels: number[]): RuleResult {
  if (setup.setupType !== 'OI_WALL_REJECTION' && setup.level && !validLevels.includes(setup.level)) {
    return fail('FAILED_VALID_LEVEL: Level is not a recognized ORH/ORL/PDH/PDL/Wall');
  }
  
  return pass();
}

export function rule8DominantOIWall(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType !== 'OI_WALL_REJECTION') return pass();
  const chainRows = ctx.chainRows;
  if (!chainRows || chainRows.length < 5) return fail('FAILED_WALL_DOMINANCE: Missing chain data');
  if (!setup.level || setup.level === 0) return fail('FAILED_WALL_DOMINANCE: No valid dominant OI wall found at this level');
  
  const sortedRows = [...chainRows].sort((a, b) => Number(a.strike_price) - Number(b.strike_price));
  const wallRowIndex = sortedRows.findIndex(r => Number(r.strike_price) === setup.level);
  
  if (wallRowIndex === -1) {
    return fail('FAILED_WALL_DOMINANCE: Strike not found');
  }

  const row = sortedRows[wallRowIndex];

  const readRequiredOi = (r: any, side: 'CE' | 'PE'): number | undefined => {
    const md = side === 'CE'
      ? r.call_options?.market_data
      : r.put_options?.market_data;
    const value = Number(md?.oi ?? md?.total_oi ?? md?.totalOi);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };

  const side = setup.direction === 'PUT' ? 'CE' : 'PE';
  const wallOi = readRequiredOi(row, side);
  
  if (wallOi === undefined) {
    return fail('FAILED_WALL_DOMINANCE: Missing required OI for wall check');
  }

  const allOIs = chainRows.map(r => readRequiredOi(r, side)).filter(oi => oi !== undefined && oi > 0) as number[];
  allOIs.sort((a, b) => a - b);
  
  if (allOIs.length === 0) {
    return fail('FAILED_WALL_DOMINANCE: No valid OI in chain');
  }
  
  let count = 0;
  for (const x of allOIs) if (x <= wallOi) count++;
  const pctRank = (count / allOIs.length) * 100;
  
  const percentileThreshold = Number(ctx.settings?.WALL_OI_PERCENTILE || 90);

  if (pctRank < percentileThreshold) {
    return fail(`FAILED_WALL_DOMINANCE: Wall OI percentile (${pctRank.toFixed(1)}%) is below threshold (${percentileThreshold}%)`);
  }

  // OI Velocity Check (15 min)
  const history = ctx.sessState.wallOIHistory?.[`${setup.level}_${side}`];
  if (history && history.length > 0) {
    const nowStr = ctx.candles1m && ctx.candles1m.length > 0 ? ctx.candles1m[ctx.candles1m.length - 1].timestamp : Date.now();
    const now = typeof nowStr === 'string' ? new Date(nowStr).getTime() : (typeof nowStr === 'number' ? nowStr : Date.now());
    const min15Ago = now - 15 * 60 * 1000;
    // Find closest to 15 mins ago
    let oldOI = null;
    let minDiff = Infinity;
    for (const entry of history) {
      const diff = Math.abs(entry.time - min15Ago);
      if (diff < minDiff) {
         minDiff = diff;
         oldOI = entry.oi;
      }
    }
    if (oldOI) {
      const velocity = ((wallOi - oldOI) / oldOI) * 100;
      if (velocity < -5) {
        return fail('FAILED_OI_VELOCITY: Wall is actively unwinding, breakout imminent');
      }
    }
  }

  const recentPeak = Number(ctx.sessState.wallPeakOI?.[setup.level]);
  const current = wallOi;
  (setup as any).wallStable = Number.isFinite(recentPeak) && Number.isFinite(current) && current >= recentPeak * 0.95;

  return pass();
}

export function rule9WallTestedTwice(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'OI_WALL_REJECTION') {
    if ((setup.wallTestCount || 0) < 2) {
      return fail('FAILED_WALL_TEST_COUNT: Wall was not tested at least 2 distinct times');
    }
  }
  return pass();
}

export function rule10BreakoutConfirmation(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST' || setup.setupType === 'OPENING_TRAP') {
    if (setup.breakCandleIndex === undefined) return fail('FAILED_BREAKOUT_CONF: Missing breakout history');
    
    // RVOL Check for Breakouts
    if ((setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN') && setup.c2) {
      if (ctx.candles1m && ctx.candles1m.length >= 20) {
        const volumes = ctx.candles1m.map(c => c.volume || 0);
        const volSMAArray = computeSMA(volumes, 20);
        const volSMA = volSMAArray[volSMAArray.length - 1];
        if (!isNaN(volSMA) && volSMA > 0) {
          const c2Volume = setup.c2.volume || 0;
          if (c2Volume < volSMA * 1.2) {
            return fail('FAILED_RVOL: Breakout lacks institutional volume');
          }
        }
      }
    }
  }
  return pass();
}

export function rule11RetestQuality(setup: ProposedSetup): RuleResult {
  if (['FAILED_RETEST', 'OPENING_TRAP'].includes(setup.setupType)) {
    if (setup.barsSinceRetest === undefined || setup.barsSinceBreakout === undefined) {
      return fail('FAILED_RETEST_SEQUENCE: Missing retest sequence data');
    }
    
    if (setup.setupType === 'OPENING_TRAP') {
      const barsToRetest = setup.retestCandleIndex !== undefined && setup.breakCandleIndex !== undefined ? setup.retestCandleIndex - setup.breakCandleIndex : 0;
      if (barsToRetest < 1 || barsToRetest > 3) {
        return fail('FAILED_RETEST_SEQUENCE: Opening trap retest must be within 1-3 candles');
      }
    }
    
    if (setup.setupType === 'FAILED_RETEST') {
      const barsToRetest = setup.retestCandleIndex !== undefined && setup.breakCandleIndex !== undefined ? setup.retestCandleIndex - setup.breakCandleIndex : 0;
      if (barsToRetest < 1 || barsToRetest > 4) {
        return fail('FAILED_RETEST_SEQUENCE: Failed retest must be within 1-4 candles');
      }
    }
  }
  return pass();
}

export function rule12ConfirmationCandle(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  if (!c0) return fail('FAILED_CONF_CANDLE: Missing confirmation candle');

  if (isCall && c0.close <= c0.open) return fail('FAILED_CONF_CANDLE: CALL setup requires green confirmation candle');
  if (!isCall && c0.close >= c0.open) return fail('FAILED_CONF_CANDLE: PUT setup requires red confirmation candle');
  
  // RVOL Check for Traps
  if (setup.setupType === 'OPENING_TRAP') {
    if (ctx.candles1m && ctx.candles1m.length >= 20) {
      const volumes = ctx.candles1m.map(c => c.volume || 0);
      const volSMAArray = computeSMA(volumes, 20);
      const volSMA = volSMAArray[volSMAArray.length - 1];
      if (!isNaN(volSMA) && volSMA > 0) {
        const c0Volume = c0.volume || 0;
        if (c0Volume < volSMA * 1.5) {
          return fail('FAILED_RVOL: Opening trap lacks institutional reversal volume');
        }
      }
    }
  }
  
  return pass();
}

export function rule13PremiumConfirmation(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'FAILED_RETEST') {
    if (setup.premiumAtConfirmation === undefined || setup.premiumAtRetestLow === undefined || setup.premiumAtBreak === undefined) {
      return fail('FAILED_PREMIUM_CONFIRMATION: Missing premium history');
    }
    if (setup.premiumAtConfirmation < setup.premiumAtRetestLow * 1.01) {
       return fail('FAILED_PREMIUM_CONFIRMATION: Premium did not expand 1% from retest low');
     }
  } else if (setup.setupType === 'OPENING_TRAP') {
     if (setup.premiumAtConfirmation === undefined || setup.premiumAtBreak === undefined || setup.premiumAtRetestLow === undefined) {
       return fail('FAILED_PREMIUM_CONFIRMATION: Missing premium history');
     }
     if (setup.premiumAtConfirmation < setup.premiumAtBreak * 1.015) {
       return fail('FAILED_PREMIUM_CONFIRMATION: Premium did not expand 1.5% from breakout');
     }
     if (setup.premiumAtConfirmation < setup.premiumAtRetestLow) {
       return fail('FAILED_PREMIUM_CONFIRMATION: Premium did not rise again after retest');
     }
  } else if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN') {
    if (
      setup.premiumConfirmationClose === undefined ||
      setup.premiumPauseLow === undefined ||
      setup.premiumBreakMidpoint === undefined ||
      setup.premiumConfirmationHigh === undefined
    ) {
      return fail('FAILED_PREMIUM_CONFIRMATION: Missing aligned continuation premium references');
    }

    const remainsAbovePauseLow =
      setup.premiumConfirmationClose >= setup.premiumPauseLow;

    const remainsAboveBreakMidpoint =
      setup.premiumConfirmationClose >= setup.premiumBreakMidpoint;

    const makesHigherHigh =
      setup.premiumConfirmationHigh > setup.premiumBreakHigh!;

    if (!remainsAbovePauseLow || (!remainsAboveBreakMidpoint && !makesHigherHigh)) {
      return fail('FAILED_PREMIUM_CONFIRMATION: Continuation premium did not confirm');
    }
  } else if (setup.setupType === 'OI_WALL_REJECTION') {
     // premium must expand after rejection
     if (setup.premiumAtConfirmation === undefined || setup.premiumAtBreak === undefined) {
       return fail('FAILED_PREMIUM_CONFIRMATION: Missing premium history');
     }
     if (setup.premiumAtConfirmation <= setup.premiumAtBreak) {
       return fail('FAILED_PREMIUM_CONFIRMATION: Premium did not expand after rejection');
     }
  }
  
  return pass();
}

export function rule14MixedDirection(setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  
  if (isCall && c0.close <= c0.open) {
    return fail('FAILED_MIXED_DIRECTION: CALL requires bullish confirmation');
  }
  if (!isCall && c0.close >= c0.open) {
    return fail('FAILED_MIXED_DIRECTION: PUT requires bearish confirmation');
  }
  
  return pass();
}

export function rule15Overextension(setup: ProposedSetup): RuleResult {
  if (setup.moveFromBreakoutLevel !== undefined && setup.firstImpulseRange !== undefined) {
    if (setup.moveFromBreakoutLevel > 1.5 * setup.firstImpulseRange) {
      return fail('FAILED_OVEREXTENSION: Move from breakout level > 1.5x impulse candle range');
    }
  }
  
  return pass();
}

export function rule16RoomToTarget(setup: ProposedSetup): RuleResult {
  if (!setup.target1 || setup.target1 <= 0 || !setup.stopLoss || setup.stopLoss <= 0 || !setup.c0) return fail('FAILED_ROOM_TO_TARGET: Missing target, stopLoss, or candle data');
  const riskSpot = Math.abs(setup.c0.close - setup.stopLoss);
  const rewardSpot = setup.direction === 'CALL'
    ? setup.target1 - setup.c0.close
    : setup.c0.close - setup.target1;
  if (!(riskSpot > 0) || rewardSpot / riskSpot < 0.8) {
    return fail('FAILED_ROOM_TO_TARGET: Target 1 is less than 0.8R');
  }
  return pass();
}


export function rule17ChopZoneFilter(ctx: ValidationContext): RuleResult {
  const atrPeriod = ctx.settings?.CHOP_ATR_PERIOD || 14;
  const atrMultiplier = ctx.settings?.CHOP_ATR_MULTIPLIER || 1.5;
  const candles = ctx.candles1m;

  if (candles.length >= atrPeriod) {
    const atrArray = computeATR(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      candles.map((c) => c.close),
      atrPeriod
    );
    const currentAtr = atrArray[atrArray.length - 1];

    if (!isNaN(currentAtr)) {
      const minRange = currentAtr * atrMultiplier;
      const last20 = candles.slice(-20);
      if (last20.length === 20) {
        const high20 = Math.max(...last20.map((c) => c.high));
        const low20 = Math.min(...last20.map((c) => c.low));
        if (high20 - low20 < minRange) {
          return fail(`FAILED_CHOP_ZONE: 20-candle range < ATR-based floor (${minRange.toFixed(2)} points)`);
        }
      }
    }
  }
  return pass();
}

export function rule18BrokenLevelReclaimedInvalidation(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const candles = ctx.candles1m;
  if (!candles || candles.length < 3 || !setup.level) return pass();
  
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
    return fail('FAILED_RECLAIM: Broken level was reclaimed by a closed candle');
  }
  
  return pass();
}

export function rule19OverallAgreement(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  
  if (isCall && setup.c0.close < setup.level) return fail('FAILED_OVERALL_AGREEMENT: CALL setup requires spot above level');
  if (!isCall && setup.c0.close > setup.level) return fail('FAILED_OVERALL_AGREEMENT: PUT setup requires spot below level');
  
  if (setup.setupType === 'OI_WALL_REJECTION' && (setup as any).wallStable !== true) {
    return fail('FAILED_OVERALL_AGREEMENT: Wall is not stable/dominant');
  }

  return pass();
}

export function rule21HTFTrendAlignment(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST') {
    const candles = ctx.candles1m;
    if (!candles || candles.length < 30) return pass(); // Not enough data
    
    
    const timeStr = ctx.timeStr || '';
    const isMorning = timeStr >= '09:15' && timeStr <= '10:45';
    
    if (ctx.sessState.isGapDay && isMorning) {
      // Use VWAP instead of 15m EMA
      const todayStr = ctx.timeObj.toISOString().split('T')[0];
      const todayCandles = candles.filter((c: any) => {
        const ts = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
        const d = new Date(ts);
        return d.toISOString().split('T')[0] === todayStr;
      });
      
      if (todayCandles.length > 0) {
        const vwapArray = computeVWAP(todayCandles);
        const currentVwap = vwapArray[vwapArray.length - 1];
        const currentSpot = ctx.spotPrice;
        
        if (!isNaN(currentVwap)) {
          if (setup.direction === 'CALL' && currentSpot <= currentVwap) {
            return fail('FAILED_HTF_ALIGNMENT: Fighting the Intraday VWAP (Gap Day)');
          }
          if (setup.direction === 'PUT' && currentSpot >= currentVwap) {
            return fail('FAILED_HTF_ALIGNMENT: Fighting the Intraday VWAP (Gap Day)');
          }
        }
      }
      return pass();
    }

    // Synthesize 15m closes
    // We group by math.floor(time / (15*60*1000))
    const closes15m = [];
    let current15mBlock = -1;
    let lastClose = -1;
    for (const c of candles) {
      const ts = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
      const block = Math.floor(ts / (15 * 60 * 1000));
      if (block !== current15mBlock) {
        if (current15mBlock !== -1) {
          closes15m.push(lastClose);
        }
        current15mBlock = block;
      }
      lastClose = c.close;
    }
    closes15m.push(lastClose); // Push the last one
    
    if (closes15m.length >= 20) {
      const emaArray = computeEMA(closes15m, 20);
      const currentEma = emaArray[emaArray.length - 1];
      const currentSpot = ctx.spotPrice;
      
      if (!isNaN(currentEma)) {
        if (setup.direction === 'CALL' && currentSpot <= currentEma) {
          return fail('FAILED_HTF_ALIGNMENT: Fighting the 15m trend');
        }
        if (setup.direction === 'PUT' && currentSpot >= currentEma) {
          return fail('FAILED_HTF_ALIGNMENT: Fighting the 15m trend');
        }
      }
    }
  }
  return pass();
}

export function runSetupValidation(ctx: ValidationContext, setup: ProposedSetup, validLevels: number[], testCount: number = 0): RuleResult {
  const checks = [
    rule20MarketFilters(ctx, setup),
    rule21HTFTrendAlignment(ctx, setup),
    rule2OpeningFilter(ctx.timeStr, setup),
    rule5MarketStructure(ctx.sessState, setup),
    rule6FailedLevel(ctx.sessState, setup),
    rule7ValidLevels(setup, validLevels),
    rule8DominantOIWall(ctx, setup),
    rule9WallTestedTwice(setup),
    rule10BreakoutConfirmation(ctx, setup),
    rule11RetestQuality(setup),
    rule12ConfirmationCandle(ctx, setup),
    rule13PremiumConfirmation(setup),
    rule14MixedDirection(setup),
    rule15Overextension(setup),
    rule16RoomToTarget(setup),
    rule17ChopZoneFilter(ctx),
    rule18BrokenLevelReclaimedInvalidation(ctx, setup),
    rule19OverallAgreement(ctx, setup)
  ];
  for (const check of checks) {
    if (!check.passed) return check;
  }
  
  return pass();
}

export interface ConfidenceInput {
  rewardRiskRatio: number;
  premiumExpansion: number;
  oiState: number;
  spreadPercent: number;
  ivRegime: number;
  momentum: number;
  gapState: number;
  timeWindow: string;
  isExpiryAfter14: boolean;
  feedSyncPenalty: number;
}

export function calculateConfidence(input: ConfidenceInput): number {
  let score = 75; // base score

  if (input.rewardRiskRatio >= 2) score += 10;
  else if (input.rewardRiskRatio < 1) score -= 20;

  if (input.spreadPercent > (input.isExpiryAfter14 ? 1.5 : 3)) score -= 20;
  else if (input.spreadPercent < 0.5) score += 5;

  if (input.timeWindow === '10:00-12:30') score += 5;
  if (input.timeWindow === '09:15-09:20') score -= 30; // 09:15-09:20 needs explicit strong rules

  score -= input.feedSyncPenalty || 0;
  return Math.max(0, Math.min(100, score));
}
