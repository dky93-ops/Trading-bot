import {
  AppSettings,
  AppState,
  EngineDecision,
  InternalSignal,
  StrategySessionState,
  Candle,
  OptionChainSnapshot
} from './types';
import { runGlobalPreChecks, runSetupValidation, ValidationContext, ProposedSetup } from './validation-rules';

export type LocalSessionState = StrategySessionState;

export interface OIWall {
  strike: number;
  totalOI: number;
  avgSurroundingOI: number;
  oiRatio: number;
  type: 'CE' | 'PE';
  oiChange?: number;
}

export type FetchOptionDataFn = (index: string, type: 'CE'|'PE', spotPrice: number, strikeOffset?: number) => Promise<any>;
export type GetOptionChainFn = (instrumentKey: string, expiry: string) => Promise<any>;
export type GetNearestExpiryFn = (instrumentKey: string) => Promise<string>;

import { getCandles } from '../db/market';

export class StrategyEngine {
  private getCompletedCandleKey(candle: Candle): string {
    return new Date(candle.timestamp).toISOString();
  }

  private getCompletedCandleIndexByTimestamp(candles: Candle[], timestamp: string): number {
    return candles.findIndex(c => new Date(c.timestamp).toISOString() === timestamp);
  }

  private settings: AppSettings;
  private state: AppState;
  public activeSignals: Map<string, InternalSignal> = new Map();
  public overallPnL: number = 0;
  public realizedPnL: number = 0;
  public unrealizedPnL: number = 0;
  public winRate: number = 0;
  public totalTrades: number = 0;
  public winningTrades: number = 0;
  private fetchOptionData: FetchOptionDataFn;
  private getOptionChain?: GetOptionChainFn;
  private getNearestExpiry?: GetNearestExpiryFn;
  private getOptionChainHistory?: () => any[];

  private sessionStates: Record<string, LocalSessionState> = {
    'NIFTY': this.createInitialSessionState(),
  };

  constructor(
    settings: AppSettings, 
    state: AppState, 
    fetchOptionData: FetchOptionDataFn,
    getOptionChain?: GetOptionChainFn,
    getNearestExpiry?: GetNearestExpiryFn,
    getOptionChainHistory?: () => any[]
  ) {
    this.settings = settings;
    this.state = state;
    this.fetchOptionData = fetchOptionData;
    this.getOptionChain = getOptionChain;
    this.getNearestExpiry = getNearestExpiry;
    this.getOptionChainHistory = getOptionChainHistory;
  }

  
  private requireWallTolerance(): number {
    const tolerance = Number(this.settings.WALL_TOLERANCE_POINTS);
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new Error('CONFIG_ERROR: WALL_TOLERANCE_POINTS must be a positive number');
    }
    return tolerance;
  }

  private createInitialSessionState() {
    return {
      sessionHigh: 0,
      sessionLow: Infinity,
      previousDayHigh: 0,
      previousDayLow: 0,
      openingRangeHigh: 0,
      openingRangeLow: 0,
      openingRangeComplete: false,
      nearestCeWallAbove: 0,
      nearestPeWallBelow: 0,
      brokenLevelUnderWatch: null,
      retestPendingFlag: false,
      continuationPendingFlag: false,
      tradeTakenFlag: false,
      firstTargetHitFlag: false,
      trailingStopActiveFlag: false,
      lastSignalDirection: 'NONE' as const,
      last_failed_setup_level: null,
      last_failed_setup_direction: null,
      last_failed_setup_timestamp: null,
      completedTradesCount: 0,
      realizedDailyPnL: 0,
      consecutiveLosingTrades: 0,
      noNewTradeFlag: false,
      failedLevelsToday: [],
      tradedStructures: [],
      failedStructuresToday: [],
      activeStructureId: null,
      lastFailedStructureId: null,
      sessionDateIST: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      candidateCEWalls: {},
      candidatePEWalls: {},
      wallTestCounts: {},
      prevWallTotalOI: {},
      wallNegativeOICounts: {},
      lastTradeExitTime: 0,
      lastTradeCandleTime: null,
      wallTestCandleKeys: {},
      wallReactionCandleKeys: {},
      wallLastSeenOI: {},
      wallLastProcessedSnapshotKey: {},
      wallOIWeakeningConfirmed: {},
      wallPeakOI: {},
      wallNegativeOIAlignedKeys: {},
      wallInvalidForRejection: {},
      totalTradesToday: 0,
      consecutiveLosses: 0,
      confirmedBreakoutTimestamp: null,
      confirmedBreakoutLevel: null,
      confirmedBreakoutDirection: null,
      retestTimestamp: null,
      retestLevel: null,
      retestDirection: null,
      lastProcessedCandleTimestamp: null,
      currentStrategyFamily: null,
      lastConfirmedReclaimLevel: null
    };
  }

  public updateSettings(settings: AppSettings) {
    this.settings = settings;
  }

  public isMarketOpen(): boolean {
    try {
      const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const istDate = new Date(istString);
      const day = istDate.getDay(); // 0 = Sunday, 6 = Saturday
      if (day === 0 || day === 6) return false;

      const mins = istDate.getHours() * 60 + istDate.getMinutes();
      // NSE Trading Hours: 09:15 AM (555 mins) to 03:30 PM (930 mins) IST
      return mins >= 555 && mins <= 930;
    } catch (e) {
      return false;
    }
  }

  public async onTick(newState: AppState): Promise<EngineDecision[]> {
    this.state = newState;
    const newSignals: InternalSignal[] = [];
    const decisions: EngineDecision[] = [];

    // If global trading toggle is disabled or market is closed, exit active trades and return
    if (!this.settings.isTradingEnabled || !this.isMarketOpen()) {
      if (this.activeSignals.size > 0) {
        this.exitAllActiveTrades(
          !this.settings.isTradingEnabled 
            ? "Trading Paused" 
            : "Market Closed (Outside NSE Trading Hours 09:15 - 15:30 IST)"
        );
      }
      return decisions;
    }

    // Manage active trades first
    this.manageActiveTrades(newSignals);

    // Evaluate NIFTY ONLY
    if (this.state.nifty50.lastPrice > 0) {
      const sig = await this.evaluateIndex('NIFTY', this.state.nifty50.lastPrice);
      if (sig) {
        if (sig.signal !== 'NO_TRADE') {
          newSignals.push(sig);
        }
        decisions.push(this.mapToPublicDecision(sig));
      }
    }

    newSignals.forEach(s => this.activeSignals.set(s.id, s));
    
    // Calculate unrealized PnL
    this.unrealizedPnL = 0;
    for (const sig of this.activeSignals.values()) {
      const curPrice = sig.latestPrice || sig.entryPrice;
      const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
      const lotConfig = (this.settings.strategies as any)[stratKey]?.lotSize || this.settings.defaultLotsPerTrade || 1;
      const qty = 75 * lotConfig;
      this.unrealizedPnL += (curPrice - sig.entryPrice) * qty;
    }
    this.overallPnL = this.realizedPnL + this.unrealizedPnL;
    return decisions;
  }

  private mapToPublicDecision(sig: InternalSignal | any): EngineDecision {
    return {
      timestamp: sig.timestamp || new Date().toISOString(),
      signal: sig.signal || 'NO_TRADE',
      strategy_family: (sig.strategy_family || 'NONE') as any,
      direction: (sig.direction || 'NONE') as any,
      spot: sig.spot || 0,
      broken_level: sig.broken_level || 0,
      wall_above: sig.wall_above || 0,
      wall_below: sig.wall_below || 0,
      option_type: sig.option_type || 'NONE',
      strike: sig.strike || 0,
      entry: sig.entry || 0,
      stoploss: sig.stoploss || 0,
      target1: sig.target1 || 0,
      target2: sig.target2 || 0,
      confidence: sig.confidence || 0,
      reason: sig.reason || [],
      fake_signal_filters_passed: sig.fake_signal_filters_passed || [],
      fake_signal_filters_failed: sig.fake_signal_filters_failed || []
    };
  }

  private createNoTrade(index: string, spot: number, reason: string): InternalSignal {
    return {
      timestamp: new Date().toISOString(),
      signal: 'NO_TRADE',
      strategy_family: 'NONE',
      direction: 'NONE',
      spot: spot,
      broken_level: 0,
      wall_above: 0,
      wall_below: 0,
      option_type: 'NONE',
      strike: 0,
      entry: 0,
      stoploss: 0,
      target1: 0,
      target2: 0,
      confidence: 0,
      reason: [reason],
      fake_signal_filters_passed: [],
      fake_signal_filters_failed: []
    } as InternalSignal;
  }

  private async evaluateIndex(index: string, spotPrice: number): Promise<InternalSignal> {
    const timeObj = new Date();
    const timeStr = timeObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const timestampISO = timeObj.toISOString();
    const getISTDateKey = (d: Date | string | number) => {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
    };
    const currentDateIST = getISTDateKey(timeObj);

    const sessState = this.sessionStates[index];
    
    // Evaluate feed sync
    const decisionTimeframe = this.settings.DECISION_TIMEFRAME_MINUTES || 5;
    let decisionCandles = await getCandles(index, decisionTimeframe, 200);
    decisionCandles = decisionCandles
      .slice()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const nowMs = timeObj.getTime();
    const currentBucketStart =
      Math.floor(nowMs / (decisionTimeframe * 60_000)) *
      decisionTimeframe *
      60_000;

    const candles = decisionCandles.filter((c) => {
      const startMs = new Date(c.timestamp).getTime();
      return Number.isFinite(startMs) && startMs < currentBucketStart;
    });

    const latest = candles[candles.length - 1];
    if (!latest) {
      return this.createNoTrade(index, spotPrice, 'NO_TRADE: no completed decision candle');
    }

    const latestStartMs = new Date(latest.timestamp).getTime();
    const ageMs = currentBucketStart - latestStartMs;
    if (ageMs > decisionTimeframe * 60_000 * 2) {
      return this.createNoTrade(index, spotPrice, 'NO_TRADE: decision candle is stale or an interval is missing');
    }
    const lastCompletedCandle = candles[candles.length - 1];
    const completedCandleCloseTimestamp = new Date(lastCompletedCandle.timestamp).getTime() + (decisionTimeframe * 60_000);
    const optionChainTimestamp = Number(this.state.optionChainTimestamp || 0);
    if (!Number.isFinite(optionChainTimestamp) || optionChainTimestamp <= 0) {
      return this.createNoTrade(index, spotPrice, 'FAILED_FEED_SYNC: Missing option-chain snapshot timestamp');
    }
    const feedDeltaMs = Math.abs(optionChainTimestamp - completedCandleCloseTimestamp);
    if (feedDeltaMs > 15_000) {
      return this.createNoTrade(index, spotPrice, `FAILED_FEED_SYNC: Spot/option-chain delta ${feedDeltaMs}ms > 15000ms`);
    }
    const feedSyncConfidencePenalty = feedDeltaMs > 5_000 ? 5 : 0;
    sessState.feedSyncPenalty = feedSyncConfidencePenalty;
    
    // 0. Active trade gate (Rule 28)
    if (sessState.tradeTakenFlag || sessState.noNewTradeFlag) {
      return this.createNoTrade(index, spotPrice, 'Active trade gate: trade already taken');
    }
    
    if ((sessState.completedTradesCount || 0) >= 3) {
      return this.createNoTrade(index, spotPrice, 'Execution Limit: Daily trade limit (3) reached');
    }
    
    if ((sessState.consecutiveLosingTrades || 0) >= 2) {
      return this.createNoTrade(index, spotPrice, 'Execution Limit: Consecutive loss limit (2) reached');
    }
    
    let chainRows: any[] = [];
    if (this.getOptionChain) {
      try {
         let expiry = '';
         if (this.getNearestExpiry) expiry = await this.getNearestExpiry(index);
         const chain = await this.getOptionChain(index, expiry);
         if (chain && chain.length > 0) chainRows = chain;
      } catch(e) {}
    }
    const rows = [...chainRows]
      .filter((r: any) => Number.isFinite(Number(r.strike_price)))
      .sort((a: any, b: any) => Number(a.strike_price) - Number(b.strike_price));
      
    // find candidates
    const candidates = this.findCandidateOIWalls(chainRows, spotPrice, sessState);
    const nearestCeWallAbove = candidates.candidateCEWallsList.find(w => w.strike > spotPrice)?.strike || 0;
    const nearestPeWallBelow = candidates.candidatePEWallsList.find(w => w.strike < spotPrice)?.strike || 0;

    const valCtx: any = {
      activeSignals: this.activeSignals,
      index, spotPrice, timeObj, timeStr,
      candles1m: candles, sessState, settings: this.settings,
      chainRows: rows, nearestCeWallAbove, nearestPeWallBelow
    };

    let selectedSignal: InternalSignal | null = null;
    const passedFilters: string[] = [];
    const failedFilters: string[] = [];

    if (!selectedSignal && this.settings.strategies?.openingTrap?.enabled) {
      selectedSignal = await this.checkOpeningTrap(valCtx, index, spotPrice, candles, rows, sessState, nearestCeWallAbove, nearestPeWallBelow, passedFilters, failedFilters);
    }
    
    if (!selectedSignal && this.settings.strategies?.oiWallRejection?.enabled) {
      selectedSignal = await this.checkOIWallRejection(valCtx, index, spotPrice, candles, rows, sessState, nearestCeWallAbove, nearestPeWallBelow, passedFilters, failedFilters);
    }

    if (selectedSignal) {
      sessState.tradeTakenFlag = true;
      sessState.completedTradesCount = (sessState.completedTradesCount || 0) + 1;
      return selectedSignal;
    }
    
    return this.createNoTrade(index, spotPrice, failedFilters.join(', '));
  }

  private findCandidateOIWalls(chainRows: any[], spot: number, sess: LocalSessionState) {
    const candidateCEWallsList: any[] = [];
    const candidatePEWallsList: any[] = [];
    const getOI = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi ?? md?.total_oi ?? md?.totalOi ?? 0);
    };
    const getOIChange = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi_change ?? md?.oiChange ?? 0);
    };

    if (!sess.wallPeakOI) sess.wallPeakOI = {};
    if (!sess.wallNegativeOIAlignedKeys) sess.wallNegativeOIAlignedKeys = {};
    if (!sess.wallInvalidForRejection) sess.wallInvalidForRejection = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};

    for (let i = 2; i <= chainRows.length - 3; i++) {
      const row = chainRows[i];
      const strike = Number(row.strike_price);
      const ceOI = getOI(row, 'CE');
      const peOI = getOI(row, 'PE');
      const ceOIC = getOIChange(row, 'CE');
      const peOIC = getOIChange(row, 'PE');

      if (ceOI > 0) {
        if (sess.wallPeakOI[strike] === undefined) sess.wallPeakOI[strike] = ceOI;
        sess.wallPeakOI[strike] = Math.max(sess.wallPeakOI[strike], ceOI);
        if (ceOI < sess.wallPeakOI[strike] * 0.95) sess.wallOIWeakeningConfirmed[strike] = true;
        if (ceOIC < 0) {
           const timeKey = chainRows ? new Date().toISOString() : "snapshot";
           if (!sess.wallNegativeOIAlignedKeys[strike]) sess.wallNegativeOIAlignedKeys[strike] = [];
           const keys = sess.wallNegativeOIAlignedKeys[strike];
           if (keys.length === 0 || new Date().getTime() - new Date(keys[keys.length-1]).getTime() >= 180000) {
             keys.push(timeKey);
           }
        }
        if (ceOI > (sess.wallPeakOI[strike] * 1.10) && sess.wallOIWeakeningConfirmed[strike]) {
           sess.wallInvalidForRejection[strike] = true;
        }
      }
      
      const prev2 = chainRows[i - 2];
      const prev1 = chainRows[i - 1];
      const next1 = chainRows[i + 1];
      const next2 = chainRows[i + 2];

      const ceOIAvgAdj = (getOI(prev2, 'CE') + getOI(prev1, 'CE') + getOI(next1, 'CE') + getOI(next2, 'CE')) / 4;
      if (ceOI > ceOIAvgAdj * 1.5) {
        candidateCEWallsList.push({ strike, type: 'CE', totalOI: ceOI, oiChange: ceOIC });
      }

      const peOIAvgAdj = (getOI(prev2, 'PE') + getOI(prev1, 'PE') + getOI(next1, 'PE') + getOI(next2, 'PE')) / 4;
      if (peOI > peOIAvgAdj * 1.5) {
        candidatePEWallsList.push({ strike, type: 'PE', totalOI: peOI, oiChange: peOIC });
      }
    }

    return { candidateCEWallsList, candidatePEWallsList };
  }

  private async checkOpeningTrap(valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]): Promise<InternalSignal | null> {
    if (candles.length < 5) return null;
    const c0 = candles[candles.length - 1];
    const c0Date = new Date(c0.timestamp);
    const c0TimeMs = c0Date.getTime();
    const d = new Date(c0Date);
    const windowStartMs = d.setHours(9, 15, 0, 0);
    const windowEndMs = d.setHours(10, 15, 0, 0);
    if (c0TimeMs < windowStartMs || c0TimeMs > windowEndMs) return null;
    const isStrongWindow = c0TimeMs <= d.setHours(9, 45, 0, 0);

    const callBreakIdx = candles.length - 2;
    const callRetestIdx = candles.length - 1;
    const putBreakIdx = candles.length - 2;
    const putRetestIdx = candles.length - 1;

    let setup: ProposedSetup | null = null;
    if (callBreakIdx !== -1 && callRetestIdx !== -1) {
       setup = {
         direction: 'CALL', level: sess.sessionHigh, setupType: 'OPENING_TRAP',
         c0: candles[callBreakIdx], c1: candles[callRetestIdx], c2: c0,
         target1: 0, target2: 0, stopLoss: 0,
         breakCandleIndex: callBreakIdx, retestCandleIndex: callRetestIdx, confirmationCandleIndex: candles.length - 1
       };
    }
    
    if (setup) {
      setup.earlyWindow = true;
      setup.earlyStrongWindow = isStrongWindow;
      const isValid = this.validateSetup(valCtx, setup.setupType as any, setup.direction, setup.level, setup.c0, setup.c1, setup.c2, 0, 0, 0, {strike: spot, price: 100}, passed, failed, 0, 'OPENING_TRAP', 0, 0, 0, 0, setup.breakCandleIndex, setup.retestCandleIndex, setup.confirmationCandleIndex, {}, chainRows);
      if (isValid) return this.createSignal(index, spot, 'OPENING_TRAP', setup.direction, chainRows, sess, passed, failed);
    }
    return null;
  }

  private async checkOIWallRejection(valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]): Promise<InternalSignal | null> {
    if (candles.length < 3) return null;
    const c0 = candles[candles.length - 1];
    if (wallAbove > 0 && c0.high >= wallAbove - this.requireWallTolerance() && c0.close < wallAbove) {
       const tests = sess.wallTestCounts[wallAbove] || 0;
       if (tests >= 2 && sess.wallOIWeakeningConfirmed[wallAbove] === true && sess.wallInvalidForRejection[wallAbove] !== true && (sess.wallNegativeOIAlignedKeys[wallAbove]?.length >= 3)) {
         const setup: ProposedSetup = {
           direction: 'PUT', level: wallAbove, setupType: 'OI_WALL_REJECTION', c0: candles[candles.length - 2], c1: c0, c2: undefined,
           target1: 0, target2: 0, stopLoss: 0, breakCandleIndex: candles.length - 2, confirmationCandleIndex: candles.length - 1
         };
         const isValid = this.validateSetup(valCtx, 'OI_WALL_REJECTION', 'PUT', wallAbove, setup.c0, setup.c1, setup.c2, 0, 0, 0, {strike: spot, price: 100}, passed, failed, tests, 'WALL_REJECT', 0, 0, 0, 0, setup.breakCandleIndex, setup.retestCandleIndex, setup.confirmationCandleIndex, {}, chainRows);
         if (isValid) return this.createSignal(index, spot, 'OI_WALL_REJECTION', 'PUT', chainRows, sess, passed, failed);
       }
    }
    return this.createNoTrade(index, spot, 'NO_TRADE: no valid strategy setup found');
  }

  private getSnapshotAtOrBefore(
    targetMs: number,
    maxAgeMs = 90_000,
  ): OptionChainSnapshot | undefined {
    const history = (this.getOptionChainHistory?.() || [])
      .filter((s: any) => Number.isFinite(Number(s.timestamp)))
      .filter((s: any) => Number(s.timestamp) <= targetMs)
      .sort((a: any, b: any) => Number(b.timestamp) - Number(a.timestamp));

    const snapshot = history[0] as OptionChainSnapshot | undefined;
    if (!snapshot) return undefined;
    if (targetMs - Number(snapshot.timestamp) > maxAgeMs) return undefined;
    return snapshot;
  }

  private getHistoricalPremium(
    strike: number,
    type: 'CE' | 'PE',
    targetTime: string,
  ): number | undefined {
    const snapshot = this.getSnapshotAtOrBefore(new Date(targetTime).getTime());
    const row = snapshot?.rows?.find((r: any) => Number(r.strike) === Number(strike));
    const option = type === 'CE' ? row?.ce : row?.pe;
    const value = Number(option?.ltp);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  private validateSetup(valCtx: ValidationContext, setupType: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION', direction: 'CALL' | 'PUT', lvl: number, c0: Candle, c1: Candle, c2: Candle | undefined, target1: number, target2: number, stoploss: number, opt: any, passed: string[], failed: string[], testCount: number = 0, structureId?: string, barsSinceBreakout?: number, barsSinceRetest?: number, impulseRange?: number, spotMoveFromLevel?: number, breakCandleIndex?: number, retestCandleIndex?: number, confirmationCandleIndex?: number, seriesData?: any, chainRows?: any[]): boolean {
    if (structureId && valCtx.sessState.failedStructuresToday && valCtx.sessState.failedStructuresToday.includes(structureId)) {
      failed.push(`FAILED_STRUCTURE: Structure ${structureId} already failed today`);
      return false;
    }
    const selectedType: 'CE' | 'PE' = direction === 'CALL' ? 'CE' : 'PE';
    const setup: ProposedSetup = {
      direction, level: lvl, setupType, c0, c1, c2, target1, target2, stopLoss: stoploss, ceOpt: direction === 'CALL' ? opt : undefined, peOpt: direction === 'PUT' ? opt : undefined, structureId, breakCandleIndex, retestCandleIndex, confirmationCandleIndex, feedSyncPenalty: valCtx.sessState.feedSyncPenalty || 0
    };
    const selectedStrike = Number(opt?.strike ?? opt?.targetStrike ?? 0);
    if (selectedStrike <= 0) { failed.push('FAILED_PREMIUM_ALIGNMENT: selected option strike unavailable'); return false; }

    const breakPremium = breakCandleIndex !== undefined && valCtx.candles1m[breakCandleIndex] 
      ? this.getHistoricalPremium(selectedStrike, selectedType, valCtx.candles1m[breakCandleIndex].timestamp) 
      : undefined;
    
    const retestPremium = retestCandleIndex !== undefined && valCtx.candles1m[retestCandleIndex]
      ? this.getHistoricalPremium(selectedStrike, selectedType, valCtx.candles1m[retestCandleIndex].timestamp)
      : undefined;
      
    const confirmationPremium = confirmationCandleIndex !== undefined && valCtx.candles1m[confirmationCandleIndex]
      ? this.getHistoricalPremium(selectedStrike, selectedType, valCtx.candles1m[confirmationCandleIndex].timestamp)
      : undefined;

    if (setupType !== 'OI_WALL_REJECTION' && (breakPremium === undefined || confirmationPremium === undefined)) { 
      failed.push('FAILED_PREMIUM_ALIGNMENT: required premium window missing'); 
      return false; 
    }
    
    setup.premiumAtBreak = breakPremium;
    setup.premiumAtConfirmation = confirmationPremium;

    if ((setupType === 'FAILED_RETEST' || setupType === 'OPENING_TRAP') && retestPremium !== undefined) {
      setup.premiumAtRetestLow = retestPremium;
    }
    
    return true; // Simplified for reconstruction
  }

  private computeSpotTargets(direction: 'CALL' | 'PUT', spot: number, brokenLevel: number, chainRows: any[], sess: LocalSessionState) {
    let structuralStopSpot = direction === 'CALL' ? spot - 15 : spot + 15;
    let target1Spot = direction === 'CALL' ? spot + (spot - structuralStopSpot) * 1.5 : spot - (structuralStopSpot - spot) * 1.5;
    let target2Base = direction === 'CALL' ? spot + (spot - structuralStopSpot) * 3.0 : spot - (structuralStopSpot - spot) * 3.0;
    let nearestOpposingWall: number | undefined;
    const candidates = this.findCandidateOIWalls(chainRows, spot, sess);
    if (direction === 'CALL') {
      const walls = candidates.candidateCEWallsList.filter(w => w.strike > spot).sort((a,b) => a.strike - b.strike);
      if (walls.length > 0) nearestOpposingWall = walls[0].strike;
    } else {
      const walls = candidates.candidatePEWallsList.filter(w => w.strike < spot).sort((a,b) => b.strike - a.strike);
      if (walls.length > 0) nearestOpposingWall = walls[0].strike;
    }
    let target2Spot = target2Base;
    if (nearestOpposingWall !== undefined) {
      if (direction === 'CALL') { if (nearestOpposingWall < target2Base) target2Spot = nearestOpposingWall - 5; } 
      else { if (nearestOpposingWall > target2Base) target2Spot = nearestOpposingWall + 5; }
    }
    return { structuralStopSpot, target1Spot, target2Spot };
  }

  private calculateDeterministicConfidence(setup: ProposedSetup): number {
    let score = 50;
    score += 20;
    if ((setup.rewardToRiskTarget1 || 0) >= 1.0) score += 10;
    if ((setup.rewardToRiskTarget2 || 0) >= 1.5) score += 5;
    const bp = setup.premiumBreakClose ?? setup.premiumAtBreak ?? 0;
    const cp = setup.premiumConfirmationClose ?? setup.premiumAtConfirmation ?? 0;
    if (bp > 0 && cp > bp) {
      const expansion = ((cp - bp) / bp) * 100;
      if (expansion >= 1.5) score += 10;
    }
    if (setup.setupType === 'OI_WALL_REJECTION') { if (setup.wallWeakeningConfirmed) score += 10; }
    if (setup.earlyWindow && !setup.earlyStrongWindow) score -= 10;
    if ((setup.spreadPercent || 999) <= 1.5) score += 5;
    if ((setup.spreadPercent || 0) > 1.5 && (setup.spreadPercent || 0) <= 3.0) score -= 10;
    if (setup.ivPenalty) score -= setup.ivPenalty;
    if (setup.feedSyncPenalty) score -= setup.feedSyncPenalty;
    return Math.max(0, Math.min(100, score));
  }

    private selectStrike(direction: 'CALL' | 'PUT', spot: number, chainRows: any[]) {
    if (!chainRows || chainRows.length === 0) return null;
    const sorted = [...chainRows].sort((a, b) => Number(a.strike_price) - Number(b.strike_price));
    
    // Find closest ATM strike
    let closestRow = sorted[0];
    let minDiff = Math.abs(Number(closestRow.strike_price) - spot);
    let atmIndex = 0;
    
    for (let i = 1; i < sorted.length; i++) {
      const diff = Math.abs(Number(sorted[i].strike_price) - spot);
      if (diff < minDiff) {
        minDiff = diff;
        closestRow = sorted[i];
        atmIndex = i;
      }
    }

    // Select ITM strike (1 strike ITM for better delta)
    let selectedRow = closestRow;
    if (direction === 'CALL' && atmIndex > 0) {
      selectedRow = sorted[atmIndex - 1]; // Lower strike for CALL is ITM
    } else if (direction === 'PUT' && atmIndex < sorted.length - 1) {
      selectedRow = sorted[atmIndex + 1]; // Higher strike for PUT is ITM
    }

    const type = direction === 'CALL' ? 'CE' : 'PE';
    const optData = direction === 'CALL' ? selectedRow.call_options : selectedRow.put_options;
    const ltp = Number(optData?.market_data?.ltp);

    if (!Number.isFinite(ltp) || ltp <= 0) return null;

    return {
      strike: Number(selectedRow.strike_price),
      type,
      price: ltp,
      instrumentKey: String(optData?.instrument_key || ''),
      iv: Number(optData?.option_greeks?.iv || 0),
      delta: Number(optData?.option_greeks?.delta || 0)
    };
  }

  private createSignal(index: string, spot: number, setupType: string, direction: 'CALL' | 'PUT', chainRows: any[], sess: LocalSessionState, passed: string[], failed: string[]): InternalSignal | null {
    const targets = this.computeSpotTargets(direction, spot, spot, chainRows, sess);
    if (!targets) return null;
    
    const opt = this.selectStrike(direction, spot, chainRows);
    if (!opt) {
      // return this.createNoTrade(index, spot, 'FAILED_STRIKE_SELECTION: No suitable option found');
      return null;
    }
    
    const setup: ProposedSetup = { direction, level: spot, setupType: setupType as any, c0: {} as any, c1: {} as any, target1: targets.target1Spot, target2: targets.target2Spot, stopLoss: targets.structuralStopSpot };
    const conf = this.calculateDeterministicConfidence(setup);
    if (conf < 50) return null;
    
    const optionRiskPercent = this.settings.MAX_OPTION_SPREAD_PERCENT || 10;
    const optionRisk = opt.price * (optionRiskPercent / 100);
    const prices = {
      spotEntry: spot,
      spotInvalidation: targets.structuralStopSpot,
      spotTarget1: targets.target1Spot,
      spotTarget2: targets.target2Spot,
      optionEntry: opt.price,
      optionStoploss: opt.price - optionRisk,
      optionTarget1: opt.price + (optionRisk * 2),
      optionTarget2: opt.price + (optionRisk * 4)
    };

    return {
      id: index + '_' + Date.now(),
      index,
      contract: 'NIFTY',
      instrumentKey: opt.instrumentKey,
      timestamp: new Date().toISOString(),
      signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
      strategy_family: setupType as any,
      direction,
      prices,
      spotEntry: prices.spotEntry,
      spotInvalidation: prices.spotInvalidation,
      spotTarget1: prices.spotTarget1,
      spotTarget2: prices.spotTarget2,
      optionEntry: prices.optionEntry,
      optionStoploss: prices.optionStoploss,
      optionTarget1: prices.optionTarget1,
      optionTarget2: prices.optionTarget2,
      spot, // legacy
      entryPrice: opt.price, // legacy
      stoploss: targets.structuralStopSpot, // legacy
      target1: targets.target1Spot, // legacy
      target2: targets.target2Spot, // legacy
      confidence: conf,
      reason: passed,
      status: 'ACTIVE',
      highestPrice: opt.price,
      latestSpot: spot,
      latestSpotTimestamp: Date.now(),
      latestOptionTimestamp: Date.now()
    } as any;
  }

private manageActiveTrades(newSignals: InternalSignal[]) {
    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'CLOSED') {
        this.activeSignals.delete(id);
        continue;
      }

      const currentOptPrice = signal.latestPrice || signal.optionEntry || signal.entryPrice;
      const currentSpot = this.state.nifty50.lastPrice;

      signal.highestPrice = Math.max(signal.highestPrice || currentOptPrice, currentOptPrice);

      const isCall = signal.direction === 'CALL' || signal.signal === 'BUY_CALL';
      const pnl = currentOptPrice - (signal.optionEntry || signal.entryPrice);
      
      const hitStop =
        currentOptPrice <= (signal.prices?.optionStoploss || signal.stoploss) ||
        (isCall && currentSpot <= (signal.prices?.spotInvalidation || signal.stoploss)) ||
        (!isCall && currentSpot >= (signal.prices?.spotInvalidation || signal.stoploss));

      const hitTarget =
        currentOptPrice >= (signal.prices?.optionTarget1 || signal.target1) ||
        (isCall && currentSpot >= (signal.prices?.spotTarget1 || signal.target1)) ||
        (!isCall && currentSpot <= (signal.prices?.spotTarget1 || signal.target1));

      if (hitStop) {
        this.closeSignal(signal, currentOptPrice, 'Stop Loss Hit');
        newSignals.push(signal);
      } else if (hitTarget) {
        this.closeSignal(signal, currentOptPrice, 'Target 1 Reached');
        newSignals.push(signal);
      } else if (signal.highestPrice > (signal.optionEntry || signal.entryPrice) * 1.1) {
        if (signal.prices) {
            signal.prices.optionStoploss = signal.optionEntry;
        } else {
            signal.stoploss = signal.entryPrice;
        }
      }
    }
  }

  private closeSignal(signal: InternalSignal, exitPrice: number, reason: string) {
    const sess = this.sessionStates[signal.index || 'NIFTY'];
    if (sess) {
      sess.tradeTakenFlag = false;
      if (reason.includes("SL TRIGGERED") || reason.includes("INVALIDATION") || reason.includes("EMERGENCY")) {
        sess.last_failed_setup_level = signal.broken_level;
        sess.last_failed_setup_direction = signal.direction;
        sess.last_failed_setup_timestamp = new Date().toISOString();
        sess.consecutiveLosingTrades = (sess.consecutiveLosingTrades || 0) + 1;
        if (sess.consecutiveLosingTrades >= 2) sess.noNewTradeFlag = true;
      } else {
        sess.consecutiveLosingTrades = 0;
      }
      sess.completedTradesCount = (sess.completedTradesCount || 0) + 1;
      if (sess.completedTradesCount >= 3) sess.noNewTradeFlag = true;
      
      const pnl = exitPrice - signal.entryPrice;
      sess.realizedDailyPnL = (sess.realizedDailyPnL || 0) + pnl;
    }
    signal.status = 'CLOSED';
    signal.exitPrice = exitPrice;
    signal.exitTime = Date.now();

    const lotQuantity = 75;
    const stratKey = signal.strategy_family ? signal.strategy_family.toLowerCase() : '';
    const stratLotConfig = (this.settings.strategies as any)[stratKey]?.lotSize;
    const lots = stratLotConfig || this.settings.defaultLotsPerTrade || 1;
    const qty = lotQuantity * lots;

    signal.realizedPnL = (exitPrice - signal.entryPrice) * qty;
    this.realizedPnL += signal.realizedPnL;
    this.totalTrades += 1;
    if (signal.realizedPnL > 0) this.winningTrades += 1;
    this.winRate = this.totalTrades > 0 ? (this.winningTrades / this.totalTrades) * 100 : 0;

    const sessState2 = this.sessionStates[signal.index];
    if (sessState2) {
      sessState2.lastTradeExitTime = Date.now();
      if (signal.realizedPnL < 0 || reason.includes('SL') || reason.includes('INVALIDATION')) {
        if (signal.broken_level > 0) {
          sessState2.last_failed_setup_level = signal.broken_level;
          if (!sessState2.failedLevelsToday.includes(signal.broken_level)) {
            sessState2.failedLevelsToday.push(signal.broken_level);
          }
        }
        if (signal.structureId) {
          sess.lastFailedStructureId = signal.structureId;
          if (!sess.failedStructuresToday.includes(signal.structureId)) {
            sess.failedStructuresToday.push(signal.structureId);
          }
        }
      }
    }

    this.activeSignals.delete(signal.id);
  }

  public exitAllActiveTrades(reason: string) {
    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'ACTIVE') {
        const curPrice = signal.latestPrice || signal.optionEntry || signal.entryPrice;
        this.closeSignal(signal, curPrice, reason);
      }
    }
  }
}
