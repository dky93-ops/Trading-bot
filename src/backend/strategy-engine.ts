import { computeEMA, computeSMA, computeRSI, computeMACD, computeBollinger, computeATR, computeSuperTrend, computeADX, computeAlphaTrend, computeT3 } from './technical-indicators';
import { computeKMeansAdaptiveSuperTrend, computeCMMACD } from './ml-adaptive-supertrend';
import { NiftyMacdAdaptiveSupertrend } from './nifty-macd-adaptive-supertrend';
import {
  AppSettings,
  AppState,
  EngineDecision,
  InternalSignal,
  StrategySessionState,
  Candle,
  OptionChainSnapshot,
  TradingSymbol
} from './types';
import { runGlobalPreChecks, runSetupValidation, ValidationContext, ProposedSetup } from './validation-rules';
import { StrategySignalsGenerator } from './strategy-signals-generator.js';

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
import { calculateConfidence } from './validation-rules';
import { validateFeedSync } from './feed-validation';
import {
  normalizeChainRows,
  readHistoricalPremium,
} from './strategy-data';


export class StrategyEngine {
  private recordWallTests(
    walls: { candidateCEWallsList: any[]; candidatePEWallsList: any[] },
    candles: Candle[],
    sess: LocalSessionState,
    tolerance: number,
  ): void {
    const candle = candles[candles.length - 1];
    if (!candle) return;
    const candleKey = new Date(candle.timestamp).toISOString();

    const record = (wall: any, rejected: boolean) => {
      if (!rejected) return;
      const strike = Number(wall.strike);
      const keys = sess.wallTestCandleKeys[strike] || [];
      if (!keys.includes(candleKey)) {
        keys.push(candleKey);
        sess.wallTestCandleKeys[strike] = keys;
        sess.wallTestCounts[strike] = keys.length;
      }
      const reactions = sess.wallReactionCandleKeys[strike] || [];
      if (!reactions.includes(candleKey)) {
        reactions.push(candleKey);
        sess.wallReactionCandleKeys[strike] = reactions;
      }
    };

    for (const wall of walls.candidateCEWallsList) {
      record(
        wall,
        candle.high >= wall.strike - tolerance && candle.close < wall.strike,
      );
    }
    for (const wall of walls.candidatePEWallsList) {
      record(
        wall,
        candle.low <= wall.strike + tolerance && candle.close > wall.strike,
      );
    }
  }

  private prepareSessionLevels(candles: Candle[], now: Date, sess: LocalSessionState): void {
    const getISTDate = (d: Date | string | number) => {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    };

    const currentSessionDate = getISTDate(now);
    sess.sessionDateIST = currentSessionDate;

    // Group completed candles by IST session date
    const candlesByDate: Record<string, Candle[]> = {};
    for (const c of candles) {
      const d = getISTDate(c.timestamp);
      if (!candlesByDate[d]) candlesByDate[d] = [];
      candlesByDate[d].push(c);
    }

    const todayCandles = (candlesByDate[currentSessionDate] || []).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (todayCandles.length > 0) {
      sess.sessionHigh = Math.max(...todayCandles.map((c) => c.high));
      sess.sessionLow = Math.min(...todayCandles.map((c) => c.low));
    } else {
      sess.sessionHigh = 0;
      sess.sessionLow = Infinity;
    }

    // Previous day levels from the most recent prior trading session
    const priorDates = Object.keys(candlesByDate)
      .filter((d) => d < currentSessionDate)
      .sort();

    if (priorDates.length > 0) {
      const lastPriorDate = priorDates[priorDates.length - 1];
      const priorCandles = candlesByDate[lastPriorDate];
      if (priorCandles && priorCandles.length >= 75) {
        sess.previousDayHigh = Math.max(...priorCandles.map((c) => c.high));
        sess.previousDayLow = Math.min(...priorCandles.map((c) => c.low));
        sess.previousDayClose = priorCandles[priorCandles.length - 1].close;
        if (todayCandles.length > 0) sess.isGapDay = Math.abs((todayCandles[0].open - sess.previousDayClose) / sess.previousDayClose * 100) > 0.4;
        sess.previousDayClose = priorCandles[priorCandles.length - 1].close;
        sess.isGapDay = Math.abs((todayCandles[0]?.open - sess.previousDayClose) / sess.previousDayClose * 100) > 0.4;
      } else if (priorCandles && priorCandles.length > 0) {
        sess.previousDayHigh = Math.max(...priorCandles.map((c) => c.high));
        sess.previousDayLow = Math.min(...priorCandles.map((c) => c.low));
        sess.previousDayClose = priorCandles[priorCandles.length - 1].close;
        if (todayCandles.length > 0) sess.isGapDay = Math.abs((todayCandles[0].open - sess.previousDayClose) / sess.previousDayClose * 100) > 0.4;
      } else {
        sess.previousDayHigh = 0;
        sess.previousDayLow = 0;
      }
    } else {
      sess.previousDayHigh = 0;
      sess.previousDayLow = 0;
    }

    // Opening range from first three completed 5-minute candles of current session (09:15-09:30)
    const openingCandles = todayCandles.slice(0, 3);
    if (openingCandles.length === 3) {
      sess.openingRangeComplete = true;
      sess.openingRangeHigh = Math.max(...openingCandles.map((c) => c.high));
      sess.openingRangeLow = Math.min(...openingCandles.map((c) => c.low));
    } else {
      sess.openingRangeComplete = false;
      sess.openingRangeHigh = 0;
      sess.openingRangeLow = 0;
    }
  }

  private validStructureLevels(sess: LocalSessionState): number[] {
    return [
      sess.previousDayHigh,
      sess.previousDayLow,
      sess.openingRangeHigh,
      sess.openingRangeLow,
      sess.nearestCeWallAbove,
      sess.nearestPeWallBelow,
    ].filter((value) => Number.isFinite(value) && value > 0);
  }

  private wallHistoryKey(side: 'CE' | 'PE', strike: number): string {
    const expiry = this.settings.expiryDate || 'CURRENT';
    return `${expiry}|${side}|${strike}`;
  }

  private readRequiredOi(row: any, side: 'CE' | 'PE'): number | undefined {
    const md = side === 'CE'
      ? row?.call_options?.market_data
      : row?.put_options?.market_data;
    const value = Number(md?.oi ?? md?.total_oi ?? md?.totalOi);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  private recordWallOi(side: 'CE' | 'PE', strike: number, currentOi: number, snapshotTimestamp: number, sess: LocalSessionState): void {
    if (!Number.isFinite(currentOi) || currentOi < 0) return;
    const key = this.wallHistoryKey(side, strike);
    if (!sess.wallOiHistory) sess.wallOiHistory = {};
    if (!sess.wallStableByKey) sess.wallStableByKey = {};
    const values = sess.wallOiHistory[key] || [];
    const last = values[values.length - 1];

    if (last !== undefined && last === currentOi) return;
    values.push(currentOi);
    sess.wallOiHistory[key] = values.slice(-20);

    const peak = Math.max(...sess.wallOiHistory[key]);
    sess.wallStableByKey[key] = currentOi >= peak * 0.95;
  }

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

  public history: Map<string, InternalSignal> = new Map();
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
      previousDayClose: 0,
      isGapDay: false,
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
    wallOiHistory: {},
    wallStableByKey: {},
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

  public isMcxMarketOpen(): boolean {
    try {
      const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const istDate = new Date(istString);
      const day = istDate.getDay(); // 0 = Sunday, 6 = Saturday
      if (day === 0 || day === 6) return false;

      const mins = istDate.getHours() * 60 + istDate.getMinutes();
      // MCX Trading Hours: 09:00 AM (540 mins) to 11:30 PM (1410 mins) IST
      return mins >= 540 && mins <= 1410;
    } catch (e) {
      return false;
    }
  }

  public async onTick(newState: AppState): Promise<any[]> {
    this.state = newState;
    const newSignals: InternalSignal[] = [];
    const decisions: EngineDecision[] = [];

    const nseOpen = this.isMarketOpen();
    const mcxOpen = this.isMcxMarketOpen();
    const anyMarketOpen = nseOpen || mcxOpen;

    // If global trading toggle is disabled or all markets are closed, exit active trades and return
    if (!this.settings.isTradingEnabled || !anyMarketOpen) {
      if (this.activeSignals.size > 0) {
        this.exitAllActiveTrades(
          !this.settings.isTradingEnabled 
            ? "Trading Paused" 
            : "Market Closed (Outside Trading Hours)"
        );
      }
      return [
        ...Array.from(this.activeSignals.values()),
        ...Array.from(this.history.values()).reverse()
      ].slice(0, 15);
    }

    // If NSE closed, exit only NSE trades
    if (!nseOpen) {
      for (const [id, signal] of this.activeSignals.entries()) {
        if (signal.index === 'NIFTY' && signal.status === 'ACTIVE') {
          this.closeSignal(signal, signal.latestPrice || signal.entryPrice, 'Day End Close: Outside NSE Trading Hours (No Overnight Carry)');
        }
      }
    }

    // If MCX closed, exit MCX Gold trades
    if (!mcxOpen) {
      for (const [id, signal] of this.activeSignals.entries()) {
        if (signal.index === 'GOLD' && signal.status === 'ACTIVE') {
          this.closeSignal(signal, signal.latestPrice || signal.entryPrice, 'Day End Close: Outside MCX Trading Hours (No Overnight Carry)');
        }
      }
    }

    // Manage active trades first
    this.manageActiveTrades(newSignals);

    // Evaluate NIFTY ONLY when NSE open
    if (nseOpen && this.state.nifty50.lastPrice > 0) {
      const sig = await this.evaluateIndex('NIFTY', this.state.nifty50.lastPrice);
      if (sig) {
        if (sig.signal !== 'NO_TRADE') {
          newSignals.push(sig);
        }
        decisions.push(this.mapToPublicDecision(sig));
      }
    }

    // Evaluate GOLD (Rob Booker - ADX Breakout)
    if (this.state.gold && this.state.gold.lastPrice > 0) {
      const goldSig = await this.evaluateGold(this.state.gold.lastPrice);
      if (goldSig && goldSig.signal !== 'NO_TRADE') {
        newSignals.push(goldSig);
      }
    }

    newSignals.forEach(s => this.activeSignals.set(s.id, s));
    
    // Calculate unrealized PnL
    this.unrealizedPnL = 0;
    for (const sig of this.activeSignals.values()) {
      const curPrice = sig.latestPrice || sig.entryPrice;
      const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
      const lotConfig = (this.settings.strategies as any)[stratKey]?.lotSize || this.settings.defaultLotsPerTrade || 1;
      const isGold = sig.index === 'GOLD';
      const qty = isGold ? lotConfig : 75 * lotConfig;
      const isShort = sig.signal === 'SELL' || sig.direction === 'PUT';
      const pnlPerUnit = isShort ? (sig.entryPrice - curPrice) : (curPrice - sig.entryPrice);
      this.unrealizedPnL += pnlPerUnit * qty;
    }
    this.overallPnL = this.realizedPnL + this.unrealizedPnL;
    // Instead of just new decisions, return all active and recently closed signals so the frontend can display them properly
    const allSignals = [
      ...Array.from(this.activeSignals.values()),
      ...Array.from(this.history.values()).reverse()
    ].slice(0, 15);
    return allSignals;
  }

  private async evaluateGold(spotPrice: number): Promise<InternalSignal | null> {
    const isTradingEnabled = this.settings.isTradingEnabled !== false;
    const isAdxBreakoutEnabled = (this.settings.strategies as any)?.adxBreakout?.enabled !== false;
    const isAlphaTrendEnabled = (this.settings.strategies as any)?.alphaTrend?.enabled === true;
    if (!isTradingEnabled || (!isAdxBreakoutEnabled && !isAlphaTrendEnabled)) return null;

    // Intraday rule: Do NOT open fresh positions near day end (after 23:15 IST)
    try {
      const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const istDate = new Date(istString);
      const totalMins = istDate.getHours() * 60 + istDate.getMinutes();
      if (totalMins >= 23 * 60 + 15) return null;
    } catch (_) {}

    // Check if there is already an active trade for GOLD
    for (const signal of this.activeSignals.values()) {
      if (signal.index === 'GOLD' && signal.status === 'ACTIVE') {
        return null;
      }
    }

    // Fetch GOLD 1m candles
    let candles = await getCandles('GOLD', 1, 60);
    if (!candles || candles.length < 35) return null;

    candles = candles.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const closePrices = candles.map(c => c.close);
    const highPrices = candles.map(c => c.high);
    const lowPrices = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume || 1);

    const atrData = computeATR(highPrices, lowPrices, closePrices, 14);
    const lastIdx = candles.length - 1;
    const prevIdx = lastIdx - 1;
    const currCandle = candles[lastIdx];
    const prevCandle = candles[prevIdx];
    const atr = atrData[lastIdx] || 1;
    const currClose = currCandle.close;
    const prevClose = prevCandle.close;

    const timeObj = new Date();
    const timestampISO = timeObj.toISOString();

    // -------------------------------------------------------------------------
    // Strategy 1: AlphaTrend Strategy for Gold (if enabled)
    // -------------------------------------------------------------------------
    if (isAlphaTrendEnabled) {
      const alpha = computeAlphaTrend(highPrices, lowPrices, closePrices, volumes, 14, 1.0, false);
      const isBuySignal = alpha.buySignal[lastIdx];
      const isSellSignal = alpha.sellSignal[lastIdx];

      if (isBuySignal) {
        const entryPrice = currClose;
        const targetDist = 1.8 * atr;
        const riskDist = 1.2 * atr;
        const target = entryPrice + targetDist;
        const stopLoss = entryPrice - riskDist;
        const id = `GOLD-${timeObj.getTime()}-ALPHATREND-BUY`;

        return {
          id,
          timestamp: timestampISO,
          signal: 'BUY',
          strategy: 'alphaTrend',
          strategy_family: 'ALPHATREND',
          strategy_name: 'AlphaTrend Strategy (Gold)',
          direction: 'CALL',
          index: 'GOLD',
          instrumentKey: this.state.gold?.instrumentToken || (this.settings as any).goldInstrumentKey || 'MCX_FO|483079',
          entry: entryPrice,
          entryPrice: entryPrice,
          latestPrice: entryPrice,
          stoploss: stopLoss,
          optionStoploss: stopLoss,
          target: target,
          target1: target,
          target2: target + 1.0 * atr,
          optionTarget1: target,
          optionTarget2: target + 1.0 * atr,
          optionEntry: entryPrice,
          spotEntry: entryPrice,
          spotInvalidation: stopLoss,
          spotTarget1: target,
          spotTarget2: target + 1.0 * atr,
          confidence: 89,
          status: 'ACTIVE',
          reason: [
            `AlphaTrend Bullish Momentum Cross on Gold`,
            `Dynamic AlphaTrend Support: ${alpha.alphaTrend[lastIdx]?.toFixed(1)}`,
            `Target: +1.8x ATR (${target.toFixed(1)})`,
            `Stop Loss: -1.2x ATR (${stopLoss.toFixed(1)})`,
            `Breakeven Protection: Auto-locks SL to entry at 50% target`
          ],
          entryTime: timeObj.getTime(),
          latestOptionTimestamp: timeObj.getTime()
        } as any;
      } else if (isSellSignal) {
        const entryPrice = currClose;
        const targetDist = 1.8 * atr;
        const riskDist = 1.2 * atr;
        const target = entryPrice - targetDist;
        const stopLoss = entryPrice + riskDist;
        const id = `GOLD-${timeObj.getTime()}-ALPHATREND-SELL`;

        return {
          id,
          timestamp: timestampISO,
          signal: 'SELL',
          strategy: 'alphaTrend',
          strategy_family: 'ALPHATREND',
          strategy_name: 'AlphaTrend Strategy (Gold)',
          direction: 'PUT',
          index: 'GOLD',
          instrumentKey: this.state.gold?.instrumentToken || (this.settings as any).goldInstrumentKey || 'MCX_FO|483079',
          entry: entryPrice,
          entryPrice: entryPrice,
          latestPrice: entryPrice,
          stoploss: stopLoss,
          optionStoploss: stopLoss,
          target: target,
          target1: target,
          target2: target - 1.0 * atr,
          optionTarget1: target,
          optionTarget2: target - 1.0 * atr,
          optionEntry: entryPrice,
          spotEntry: entryPrice,
          spotInvalidation: stopLoss,
          spotTarget1: target,
          spotTarget2: target - 1.0 * atr,
          confidence: 89,
          status: 'ACTIVE',
          reason: [
            `AlphaTrend Bearish Momentum Cross on Gold`,
            `Dynamic AlphaTrend Resistance: ${alpha.alphaTrend[lastIdx]?.toFixed(1)}`,
            `Target: -1.8x ATR (${target.toFixed(1)})`,
            `Stop Loss: +1.2x ATR (${stopLoss.toFixed(1)})`,
            `Breakeven Protection: Auto-locks SL to entry at 50% target`
          ],
          entryTime: timeObj.getTime(),
          latestOptionTimestamp: timeObj.getTime()
        } as any;
      }
    }

    // -------------------------------------------------------------------------
    // Strategy 2: Rob Booker - ADX Breakout & Retest Engine for Gold
    // -------------------------------------------------------------------------
    if (isAdxBreakoutEnabled) {
      const adxData = computeADX(highPrices, lowPrices, closePrices, 14);
      const sig = adxData.adx[lastIdx];
      if (isNaN(sig)) return null;

      // boxLookBack = 20
      const boxLookBack = 20;
      if (lastIdx < boxLookBack + 1) return null;

      let prevBoxUpper = -Infinity;
      let prevBoxLower = Infinity;
      for (let k = lastIdx - boxLookBack; k < lastIdx; k++) {
        prevBoxUpper = Math.max(prevBoxUpper, highPrices[k]);
        prevBoxLower = Math.min(prevBoxLower, lowPrices[k]);
      }
      const boxWidth = prevBoxUpper - prevBoxLower;
      if (boxWidth <= 0) return null;

      // Reject climax exhaustion candles (avoids buying at peak blow-offs)
      const barRange = currCandle.high - currCandle.low;
      if (barRange > 2.5 * atr) return null;

      const entryMode = (this.settings as any).goldEntryMode || 'BREAKOUT';

      // 1. Direct Breakout Detection
      const isADXLow = sig < 24;
      const isBuyBreakout = isADXLow && prevClose <= prevBoxUpper && currClose > prevBoxUpper;
      const isSellBreakout = isADXLow && prevClose >= prevBoxLower && currClose < prevBoxLower;

      // 2. Retest Detection
      // Check if price previously broke out 1 to 5 bars ago, and current bar confirms pullback retest of the broken level
      let isBuyRetest = false;
      let isSellRetest = false;

      if (entryMode === 'RETEST' || entryMode === 'ADAPTIVE') {
        for (let look = 1; look <= 5; look++) {
          const testIdx = lastIdx - look;
          if (testIdx < boxLookBack + 1) break;
          const bPrev = candles[testIdx - 1];
          const bCurr = candles[testIdx];
          const bAdx = adxData.adx[testIdx];

          // Check if a valid box breakout happened at testIdx
          if (!isNaN(bAdx) && bAdx < 24) {
            let bBoxUpper = -Infinity;
            let bBoxLower = Infinity;
            for (let k = testIdx - boxLookBack; k < testIdx; k++) {
              bBoxUpper = Math.max(bBoxUpper, highPrices[k]);
              bBoxLower = Math.min(bBoxLower, lowPrices[k]);
            }

            // Buy Retest: Broke upper level, pulled back to test upper level, confirmed bounce
            if (bPrev.close <= bBoxUpper && bCurr.close > bBoxUpper) {
              const touchedLevel = currCandle.low <= bBoxUpper + 0.35 * atr && currCandle.low >= bBoxUpper - 0.5 * atr;
              const bounceConfirmed = currClose >= bBoxUpper - 0.15 * atr && (currClose >= currCandle.open || currClose > currCandle.low + 0.3 * barRange);
              if (touchedLevel && bounceConfirmed) {
                isBuyRetest = true;
                prevBoxUpper = bBoxUpper;
                break;
              }
            }

            // Sell Retest: Broke lower level, pulled back to test lower level, confirmed rejection
            if (bPrev.close >= bBoxLower && bCurr.close < bBoxLower) {
              const touchedLevel = currCandle.high >= bBoxLower - 0.35 * atr && currCandle.high <= bBoxLower + 0.5 * atr;
              const rejectConfirmed = currClose <= bBoxLower + 0.15 * atr && (currClose <= currCandle.open || currClose < currCandle.high - 0.3 * barRange);
              if (touchedLevel && rejectConfirmed) {
                isSellRetest = true;
                prevBoxLower = bBoxLower;
                break;
              }
            }
          }
        }
      }

      const shouldTakeBuy = entryMode === 'RETEST' ? isBuyRetest : (isBuyBreakout || (entryMode === 'ADAPTIVE' && isBuyRetest));
      const shouldTakeSell = entryMode === 'RETEST' ? isSellRetest : (isSellBreakout || (entryMode === 'ADAPTIVE' && isSellRetest));

      if (!shouldTakeBuy && !shouldTakeSell) return null;

      const isRetestTrade = (shouldTakeBuy && isBuyRetest) || (shouldTakeSell && isSellRetest);
      const id = `GOLD-${timeObj.getTime()}-${shouldTakeBuy ? 'BUY' : 'SELL'}-${isRetestTrade ? 'RETEST' : 'BO'}`;

      if (shouldTakeBuy) {
        const entryPrice = currClose;
        const targetDist = 0.75 * boxWidth;
        const target = entryPrice + targetDist;
        
        // Retest entry has tighter structural stop loss below retest low
        const stopLoss = isRetestTrade 
          ? Math.max(currCandle.low - 0.35 * atr, entryPrice - targetDist * 0.7)
          : entryPrice - Math.min(targetDist * 0.85, Math.max(1.0 * atr, boxWidth * 0.45));

        const newSig: InternalSignal = {
          id,
          timestamp: timestampISO,
          signal: 'BUY',
          strategy: 'adxBreakout',
          strategy_family: 'ADX_BREAKOUT',
          strategy_name: isRetestTrade ? 'Rob Booker ADX - Retest Confirmation' : 'Rob Booker - ADX Breakout',
          direction: 'CALL',
          index: 'GOLD',
          instrumentKey: this.state.gold?.instrumentToken || (this.settings as any).goldInstrumentKey || 'MCX_FO|483079',
          entry: entryPrice,
          entryPrice: entryPrice,
          latestPrice: entryPrice,
          stoploss: stopLoss,
          optionStoploss: stopLoss,
          target: target,
          target1: target,
          target2: target + boxWidth * 0.5,
          optionTarget1: target,
          optionTarget2: target + boxWidth * 0.5,
          optionEntry: entryPrice,
          spotEntry: entryPrice,
          spotInvalidation: stopLoss,
          spotTarget1: target,
          spotTarget2: target + boxWidth * 0.5,
          confidence: isRetestTrade ? 95 : 92,
          status: 'ACTIVE',
          reason: [
            isRetestTrade 
              ? `Confirmed Retest Bounce at Box Upper: ${prevBoxUpper.toFixed(1)}`
              : `Rob Booker ADX Breakout (ADX: ${sig.toFixed(1)} < 24)`,
            `Breakout level: ${prevBoxUpper.toFixed(1)}`,
            `Target: +0.75x Box Width (${target.toFixed(1)})`,
            `Tight Structural Stop Loss: (${stopLoss.toFixed(1)})`,
            `Breakeven Protection: Auto-locks SL to entry at 50% target`
          ],
          entryTime: timeObj.getTime(),
          latestOptionTimestamp: timeObj.getTime()
        } as any;

        return newSig;
      } else if (shouldTakeSell) {
        const entryPrice = currClose;
        const targetDist = 0.75 * boxWidth;
        const target = entryPrice - targetDist;
        
        const stopLoss = isRetestTrade 
          ? Math.min(currCandle.high + 0.35 * atr, entryPrice + targetDist * 0.7)
          : entryPrice + Math.min(targetDist * 0.85, Math.max(1.0 * atr, boxWidth * 0.45));

        const newSig: InternalSignal = {
          id,
          timestamp: timestampISO,
          signal: 'SELL',
          strategy: 'adxBreakout',
          strategy_family: 'ADX_BREAKOUT',
          strategy_name: isRetestTrade ? 'Rob Booker ADX - Retest Confirmation' : 'Rob Booker - ADX Breakout',
          direction: 'PUT',
          index: 'GOLD',
          instrumentKey: this.state.gold?.instrumentToken || (this.settings as any).goldInstrumentKey || 'MCX_FO|483079',
          entry: entryPrice,
          entryPrice: entryPrice,
          latestPrice: entryPrice,
          stoploss: stopLoss,
          optionStoploss: stopLoss,
          target: target,
          target1: target,
          target2: target - boxWidth * 0.5,
          optionTarget1: target,
          optionTarget2: target - boxWidth * 0.5,
          optionEntry: entryPrice,
          spotEntry: entryPrice,
          spotInvalidation: stopLoss,
          spotTarget1: target,
          spotTarget2: target - boxWidth * 0.5,
          confidence: isRetestTrade ? 95 : 92,
          status: 'ACTIVE',
          reason: [
            isRetestTrade 
              ? `Confirmed Retest Rejection at Box Lower: ${prevBoxLower.toFixed(1)}`
              : `Rob Booker ADX Breakout (ADX: ${sig.toFixed(1)} < 24)`,
            `Breakdown level: ${prevBoxLower.toFixed(1)}`,
            `Target: -0.75x Box Width (${target.toFixed(1)})`,
            `Tight Structural Stop Loss: (${stopLoss.toFixed(1)})`,
            `Breakeven Protection: Auto-locks SL to entry at 50% target`
          ],
          entryTime: timeObj.getTime(),
          latestOptionTimestamp: timeObj.getTime()
        } as any;

        return newSig;
      }
    }

    return null;
  }

  private async evaluateIndex(index: string, spotPrice: number): Promise<any> {
    const timeObj = new Date();
    const timeStr = timeObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const timestampISO = timeObj.toISOString();

    if (!this.sessionStates[index]) {
      this.sessionStates[index] = this.createInitialSessionState();
    }
    
    // Detect day rollover and reset session arrays/stats for 24/7 continuous running
    const currentSessionDate = timeObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (this.sessionStates[index].sessionDateIST !== currentSessionDate) {
      console.log(`[Strategy Engine] New trading day detected for ${index}. Resetting session state.`);
      this.sessionStates[index] = this.createInitialSessionState();
      this.sessionStates[index].sessionDateIST = currentSessionDate;
      
      // Exit any stale trades left overnight (failsafe)
      for (const [id, signal] of this.activeSignals.entries()) {
        if (signal.index === index) {
          this.closeSignal(signal, spotPrice, "Overnight Position Auto-Close");
        }
      }
    }
    
    const sessState = this.sessionStates[index];
    
    // Evaluate feed sync
    const decisionTimeframe = Number(this.settings.DECISION_TIMEFRAME_MINUTES || 5);
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
    
    const syncRes = validateFeedSync({
      candleStart: new Date(lastCompletedCandle.timestamp).getTime(),
      candleClose: completedCandleCloseTimestamp,
      optionSnapshotTimestamp: this.state.optionChainSnapshotTimestamp || 0,
      nowMs: nowMs,
      maxSnapshotLagMs: 15_000
    });
    if (!syncRes.valid) {
      return this.createNoTrade(index, spotPrice, syncRes.reason || 'FAILED_FEED_SYNC');
    }

    const feedDeltaMs = Math.abs((this.state.optionChainSnapshotTimestamp || 0) - completedCandleCloseTimestamp);
    const feedSyncConfidencePenalty = feedDeltaMs > 5_000 ? 5 : 0;
    sessState.feedSyncPenalty = feedSyncConfidencePenalty;

    const candleIso = new Date(lastCompletedCandle.timestamp).toISOString();
    if (sessState.lastProcessedCandleTimestamp === candleIso) {
      return this.createNoTrade(index, spotPrice, 'NO_TRADE: Already processed this candle');
    }

    // Prepare session levels (PDH/PDL, session high/low, opening range)
    this.prepareSessionLevels(candles, timeObj, sessState);
    
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
    const passed: string[] = [];
    const failed: string[] = [];

    if (this.getOptionChain) {
      try {
        let expiry = '';
        const upstoxInstrumentKey =
          index === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : index;

        if (this.getNearestExpiry) {
          expiry = await this.getNearestExpiry(upstoxInstrumentKey);
        }

        const chainResponse = await this.getOptionChain(
          upstoxInstrumentKey,
          expiry,
        );

        chainRows = normalizeChainRows(chainResponse);
      } catch (error) {
        failed.push(
          `FAILED_OPTION_CHAIN: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const rows = normalizeChainRows(chainRows);

    if (rows.length === 0) {
      return this.createNoTrade(
        index,
        spotPrice,
        'FAILED_OPTION_CHAIN: No usable option-chain rows',
      );
    }

    const snapshotTimestamp =
      Number(this.state.optionChainTimestamp) > 0
        ? Number(this.state.optionChainTimestamp)
        : Date.now();

    for (const row of rows) {
      const strike = Number(row.strike_price);

      if (!Number.isFinite(strike)) {
        continue;
      }

      const ceOi = this.readRequiredOi(row, 'CE');
      const peOi = this.readRequiredOi(row, 'PE');

      if (ceOi !== undefined) {
        this.recordWallOi(
          'CE',
          strike,
          ceOi,
          snapshotTimestamp,
          sessState,
        );
      }

      if (peOi !== undefined) {
        this.recordWallOi(
          'PE',
          strike,
          peOi,
          snapshotTimestamp,
          sessState,
        );
      }
    }

    const candidates = this.findCandidateOIWalls(
      rows,
      spotPrice,
      sessState,
    );

    const wallTolerance = Number(this.settings.RETEST_TOLERANCE_POINTS || 10);

    this.recordWallTests(
      candidates,
      candles,
      sessState,
      wallTolerance,
    );

    const nearestCeWallAbove =
      candidates.candidateCEWallsList.find(
        (wall) => wall.strike > spotPrice,
      )?.strike || 0;

    const nearestPeWallBelow =
      candidates.candidatePEWallsList.find(
        (wall) => wall.strike < spotPrice,
      )?.strike || 0;

    sessState.nearestCeWallAbove = nearestCeWallAbove;
    sessState.nearestPeWallBelow = nearestPeWallBelow;

    const valCtx: any = {
      activeSignals: this.activeSignals,
      index, spotPrice, timeObj, timeStr,
      candles1m: candles, sessState, settings: this.settings,
      chainRows: rows, nearestCeWallAbove, nearestPeWallBelow
    };

    const precheck = runGlobalPreChecks({
      activeSignals: this.activeSignals,
      index,
      spotPrice,
      timeObj,
      timeStr,
      sessState,
      candles1m: candles,
      chainRows: rows,
      nearestCeWallAbove,
      nearestPeWallBelow,
    });

    // 0. COMBO STRATEGIES (Filtered & Unfiltered)
    // Evaluated SOLELY on their own rules without interference from global prechecks or other strategy filters
    if (this.settings.strategies?.comboFiltered?.enabled) {
      const comboSig = await this.checkComboStrategy(
        'COMBO_FILTERED',
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passed,
        failed,
      );
      if (comboSig) {
        sessState.tradeTakenFlag = true;
        sessState.totalTradesToday = (sessState.totalTradesToday || 0) + 1;
        sessState.lastProcessedCandleTimestamp = candleIso;
        return comboSig;
      }
    }

    if (this.settings.strategies?.comboUnfiltered?.enabled) {
      const comboSig = await this.checkComboStrategy(
        'COMBO_UNFILTERED',
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passed,
        failed,
      );
      if (comboSig) {
        sessState.tradeTakenFlag = true;
        sessState.totalTradesToday = (sessState.totalTradesToday || 0) + 1;
        sessState.lastProcessedCandleTimestamp = candleIso;
        return comboSig;
      }
    }

    // 0.1 NIFTY MACD + Adaptive SuperTrend Strategy
    // Evaluated SOLELY on its own rules without interference from global prechecks or other strategy filters
    if (this.settings.strategies?.macdAdaptiveSupertrend?.enabled) {
      const macdStSig = await this.checkMacdAdaptiveSupertrendStrategy(
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        passed,
        failed,
      );
      if (macdStSig) {
        sessState.tradeTakenFlag = true;
        sessState.totalTradesToday = (sessState.totalTradesToday || 0) + 1;
        sessState.lastProcessedCandleTimestamp = candleIso;
        return macdStSig;
      }
    }

    if (!precheck.passed) {
      return this.createNoTrade(
        index,
        spotPrice,
        precheck.reason || 'FAILED_GLOBAL_PRECHECK',
      );
    }

    const minEntryTime =
      this.settings.MIN_ENTRY_TIME_IST || '09:30';

    const lastEntryTime =
      this.settings.LAST_ENTRY_TIME_IST || '15:00';

    if (timeStr < minEntryTime) {
      return this.createNoTrade(
        index,
        spotPrice,
        `FAILED_TIME_FILTER: Before minimum entry time ${minEntryTime} IST`,
      );
    }

    if (timeStr >= lastEntryTime) {
      return this.createNoTrade(
        index,
        spotPrice,
        `FAILED_TIME_FILTER: At or after last entry time ${lastEntryTime} IST`,
      );
    }

    let selectedSignal: InternalSignal | null = null;

    // 1. FAILED_RETEST (CALL and PUT)
    if (
      !selectedSignal &&
      this.settings.strategies?.failedRetest?.enabled
    ) {
      for (const direction of ['CALL', 'PUT'] as const) {
        selectedSignal = await this.checkFailedRetest(
          direction,
          valCtx,
          index,
          spotPrice,
          candles,
          rows,
          sessState,
          nearestCeWallAbove,
          nearestPeWallBelow,
          passed,
          failed,
        );

        if (selectedSignal) break;
      }
    }

    // 2. CONTINUATION_BREAKDOWN (PUT only)
    if (
      !selectedSignal &&
      this.settings.strategies?.continuationBreakdown?.enabled
    ) {
      selectedSignal = await this.checkContinuation(
        'CONTINUATION_BREAKDOWN',
        'PUT',
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passed,
        failed,
      );
    }

    // 3. CONTINUATION_BREAKOUT (CALL only)
    if (
      !selectedSignal &&
      this.settings.strategies?.continuationBreakout?.enabled
    ) {
      selectedSignal = await this.checkContinuation(
        'CONTINUATION_BREAKOUT',
        'CALL',
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passed,
        failed,
      );
    }

    // 4. OPENING_TRAP (CALL and PUT)
    if (
      !selectedSignal &&
      this.settings.strategies?.openingTrap?.enabled
    ) {
      selectedSignal = await this.checkOpeningTrap(
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passed,
        failed,
      );
    }

    // 5. OI_WALL_REJECTION
    if (
      !selectedSignal &&
      this.settings.strategies?.oiWallRejection?.enabled
    ) {
      selectedSignal = await this.checkOIWallRejection(
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passed,
        failed,
      );
    }

    if (selectedSignal) {
      sessState.tradeTakenFlag = true;
      sessState.totalTradesToday = (sessState.totalTradesToday || 0) + 1;
      sessState.lastProcessedCandleTimestamp = candleIso;
      return selectedSignal;
    }
    
    sessState.lastProcessedCandleTimestamp = candleIso;
    return this.createNoTrade(index, spotPrice, failed.join(', '));
  }

  private async checkComboStrategy(
    variant: 'COMBO_FILTERED' | 'COMBO_UNFILTERED',
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sess: LocalSessionState,
    wallAbove: number,
    wallBelow: number,
    passed: string[],
    failed: string[],
  ): Promise<InternalSignal | null> {
    if (!candles || candles.length < 25) return null;
    
    // Condition 1: One trade at a time (strictly for THIS strategy variant, no interference from any other strategy)
    const hasActiveComboTrade = Array.from(this.activeSignals.values()).some(
      s => s.status === 'ACTIVE' && s.strategy_family === variant
    );
    if (hasActiveComboTrade) return null;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 1);

    const { alphaTrend, buySignal: alphaBuy, sellSignal: alphaSell } = computeAlphaTrend(highs, lows, closes, volumes, 14, 1.0, false);
    const t3 = computeT3(closes, 14, 0.7);

    const i = candles.length - 1;
    if (i < 2) return null;

    const t3Bullish = t3.lev0[i] > t3.lev5[i];
    const t3Bearish = t3.lev0[i] < t3.lev5[i];
    const t3CrossOver = t3.lev0[i-1] <= t3.lev5[i-1] && t3.lev0[i] > t3.lev5[i];
    const t3CrossUnder = t3.lev0[i-1] >= t3.lev5[i-1] && t3.lev0[i] < t3.lev5[i];
    
    const alphaBullish = alphaTrend[i] > alphaTrend[i-2];
    const alphaBearish = alphaTrend[i] < alphaTrend[i-2];

    const comboLong = (alphaBuy[i] && t3Bullish) || (t3CrossOver && alphaBullish);
    const comboShort = (alphaSell[i] && t3Bearish) || (t3CrossUnder && alphaBearish);

    if (!comboLong && !comboShort) return null;

    const direction: 'CALL' | 'PUT' = comboLong ? 'CALL' : 'PUT';
    const atrs = computeATR(highs, lows, closes, 14);
    const atr = atrs[i] || 15;

    // Filtered version enforces SOLELY its own 4 confirmation rules (PDF Strategy)
    if (variant === 'COMBO_FILTERED') {
      const c = candles[i];
      // 1. Upstox Volume confirmation (>= 0.85x 20-period Vol SMA)
      const volSma = computeSMA(volumes, 20);
      const currVolSma = volSma[i] || 0;
      if (currVolSma > 0 && (c.volume || 0) < currVolSma * 0.85) {
        failed.push('COMBO_FILTERED: Low volume confirmation');
        return null;
      }
      // 2. Candle confirmation
      if (direction === 'CALL' && c.close < c.open) {
        failed.push('COMBO_FILTERED: Candle conviction red for Call');
        return null;
      }
      if (direction === 'PUT' && c.close > c.open) {
        failed.push('COMBO_FILTERED: Candle conviction green for Put');
        return null;
      }
      // 3. Ribbon Spread Expansion (>= 0.12x ATR)
      const ribbonSpread = Math.abs(t3.lev0[i] - t3.lev5[i]);
      if (ribbonSpread < 0.12 * atr) {
        failed.push('COMBO_FILTERED: Ribbon spread compressed');
        return null;
      }
      // 4. Trend Alignment (50 EMA)
      const ema50 = computeEMA(closes, 50);
      const currEma50 = ema50[i];
      if (!isNaN(currEma50)) {
        if (direction === 'CALL' && c.close < currEma50 - 0.25 * atr) {
          failed.push('COMBO_FILTERED: Price below 50 EMA trend');
          return null;
        }
        if (direction === 'PUT' && c.close > currEma50 + 0.25 * atr) {
          failed.push('COMBO_FILTERED: Price above 50 EMA trend');
          return null;
        }
      }
    }

    const option = this.selectStrike(direction, spot, chainRows);
    if (!option) return null;

    // Separate Stop Loss & Target Rules for Filtered vs Unfiltered
    const recentCandles = candles.slice(Math.max(0, i - 4), i + 1);
    const alphaLine = alphaTrend[i];
    let riskDist: number;

    if (variant === 'COMBO_FILTERED') {
      // PDF Section 4: Structural Spot SL with dynamic invalidation buffer (1.2x ATR buffer)
      if (direction === 'CALL') {
        const recentLow = Math.min(...recentCandles.map(c => c.low));
        const rawSL = (!isNaN(alphaLine) && alphaLine < spot) ? Math.min(recentLow, alphaLine) : recentLow;
        const rawRisk = spot - rawSL;
        riskDist = Math.min(2.5 * atr, Math.max(1.2 * atr, rawRisk > 0 ? rawRisk : atr * 1.2));
      } else {
        const recentHigh = Math.max(...recentCandles.map(c => c.high));
        const rawSL = (!isNaN(alphaLine) && alphaLine > spot) ? Math.max(recentHigh, alphaLine) : recentHigh;
        const rawRisk = rawSL - spot;
        riskDist = Math.min(2.5 * atr, Math.max(1.2 * atr, rawRisk > 0 ? rawRisk : atr * 1.2));
      }
    } else {
      // Unfiltered Strategy: Pure Technical Pivot SL (1.0x ATR buffer)
      if (direction === 'CALL') {
        const recentLow = Math.min(...recentCandles.map(c => c.low));
        const rawSL = (!isNaN(alphaLine) && alphaLine < spot) ? Math.min(recentLow, alphaLine) : recentLow;
        const rawRisk = spot - rawSL;
        riskDist = Math.min(2.5 * atr, Math.max(1.0 * atr, rawRisk > 0 ? rawRisk : atr * 1.0));
      } else {
        const recentHigh = Math.max(...recentCandles.map(c => c.high));
        const rawSL = (!isNaN(alphaLine) && alphaLine > spot) ? Math.max(recentHigh, alphaLine) : recentHigh;
        const rawRisk = rawSL - spot;
        riskDist = Math.min(2.5 * atr, Math.max(1.0 * atr, rawRisk > 0 ? rawRisk : atr * 1.0));
      }
    }

    const sl = direction === 'CALL' ? spot - riskDist : spot + riskDist;

    // Targets:
    // Filtered as per PDF Section 4: Spot Target 1 = 1:2 R:R (Risk x 2.0); Spot Target 2 = 1:3 R:R (Risk x 3.0)
    // Unfiltered: Quick Momentum Spot Target 1 = 1:1.5 R:R; Spot Target 2 = 1:2.5 R:R
    const target1 = direction === 'CALL'
      ? spot + riskDist * (variant === 'COMBO_FILTERED' ? 2.0 : 1.5)
      : spot - riskDist * (variant === 'COMBO_FILTERED' ? 2.0 : 1.5);
    const target2 = direction === 'CALL'
      ? spot + riskDist * (variant === 'COMBO_FILTERED' ? 3.0 : 2.5)
      : spot - riskDist * (variant === 'COMBO_FILTERED' ? 3.0 : 2.5);

    const targets: any = {
      target1Spot: target1,
      target2Spot: target2,
      target1Option: option.ltp + (variant === 'COMBO_FILTERED' ? riskDist * 0.5 : (direction === 'CALL' ? (target1 - spot) * 0.5 : (spot - target1) * 0.5)),
      target2Option: option.ltp + (variant === 'COMBO_FILTERED' ? riskDist * 0.75 : (direction === 'CALL' ? (target2 - spot) * 0.5 : (spot - target2) * 0.5)),
      stopLossSpot: sl,
      stopLossOption: variant === 'COMBO_FILTERED'
        ? Math.max(option.ltp * 0.65, option.ltp - riskDist * 0.5) // PDF 35% cap
        : Math.max(1, option.ltp - riskDist * 0.5),
      breakEvenThresholdOption: option.ltp,
      trailingStepOption: 5,
      riskRewardRatio: variant === 'COMBO_FILTERED' ? 2.0 : 1.5,
    };

    passed.push(variant);

    return {
      decision: {
        signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
        strategy_family: variant,
        direction,
        entryPrice: option.ltp,
        entrySpot: spot,
        underlying: index,
        instrumentKey: option.instrumentKey,
        strike: option.strike,
        optionType: direction === 'CALL' ? 'CE' : 'PE',
        stopLoss: targets.stopLossOption,
        target1: targets.target1Option,
        target2: targets.target2Option,
        invalidationLevel: sl,
        confidence: 0.85,
        status: 'OPEN',
        targets,
      } as any,
      reason: [`${variant}: Confluence of AlphaTrend & T3 Striped Ribbon (${direction})`],
      passedRules: passed,
      failedRules: failed,
      targets,
      structuralLevel: sl,
    } as any;
  }

  /**
   * NIFTY MACD + Adaptive SuperTrend Strategy
   * Evaluated strictly on its own rules without interference from other strategies.
   */
  private async checkMacdAdaptiveSupertrendStrategy(
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sessState: LocalSessionState,
    passed: string[],
    failed: string[],
  ): Promise<any | null> {
    const variant = 'MACD_ADAPTIVE_SUPERTREND';

    // Strictly enforce One trade at a time for THIS strategy variant
    const hasActiveTrade = Array.from(this.activeSignals.values()).some(
      s => s.status === 'ACTIVE' && s.strategy_family === variant
    );
    if (hasActiveTrade) return null;

    if (candles.length < 35) return null;

    const strat = new NiftyMacdAdaptiveSupertrend({
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      atrPeriod: 10,
      superTrendMultiplier: 3,
      riskPerTrade: 0.02,
      maxDailyLoss: 0.05,
      profitTarget: 0.03,
      minVolume: 0,
      enableAdaptiveMultiplier: true,
      lookbackPeriod: 100,
    });

    for (let c = 0; c < candles.length - 1; c++) {
      strat.updatePriceData(candles[c]);
    }

    const lastCandle = candles[candles.length - 1];
    const timeStr = valCtx.timeStr || '10:00';
    const sigRes = strat.generateSignals(lastCandle, 100000, timeStr);

    if (sigRes.signal !== 'BUY' && sigRes.signal !== 'SELL') {
      return null;
    }

    const direction: 'CALL' | 'PUT' = sigRes.signal === 'BUY' ? 'CALL' : 'PUT';
    const option = this.selectStrike(direction, spot, chainRows);
    if (!option) return null;

    const spotSL = sigRes.stopLoss ?? (direction === 'CALL' ? spot - 30 : spot + 30);
    const spotTP = sigRes.takeProfit ?? (direction === 'CALL' ? spot + 60 : spot - 60);
    const riskDist = Math.abs(spot - spotSL);

    const targets: any = {
      target1Spot: spotTP,
      target2Spot: direction === 'CALL' ? spot + riskDist * 3 : spot - riskDist * 3,
      target1Option: option.ltp + riskDist * 0.5,
      target2Option: option.ltp + riskDist * 1.0,
      stopLossSpot: spotSL,
      stopLossOption: Math.max(1, option.ltp - riskDist * 0.5),
      breakEvenThresholdOption: option.ltp,
      trailingStepOption: 5,
      riskRewardRatio: 2.0,
      reason: sigRes.reason,
      superTrendLevel: sigRes.superTrendLevel,
    };

    passed.push(variant);

    return {
      decision: {
        signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
        strategy_family: variant,
        direction,
        entryPrice: option.ltp,
        entrySpot: spot,
        underlying: index,
        instrumentKey: option.instrumentKey,
        strike: option.strike,
        optionType: direction === 'CALL' ? 'CE' : 'PE',
        stopLoss: targets.stopLossOption,
        target1: targets.target1Option,
        target2: targets.target2Option,
        invalidationLevel: spotSL,
        confidence: 0.90,
        status: 'OPEN',
        targets,
      } as any,
      reason: [`${variant}: ${sigRes.reason}`],
      passedRules: passed,
      failedRules: failed,
      targets,
      structuralLevel: spotSL,
    } as any;
  }

  private findCandidateOIWalls(chainRows: any[], spot: number, sess: LocalSessionState) {
    const candidateCEWallsList: any[] = [];
    const candidatePEWallsList: any[] = [];
    const getOI = (row: any, side: 'CE' | 'PE'): number | undefined => this.readRequiredOi(row, side);
    const getOIChange = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi_change ?? md?.oiChange ?? 0);
    };

        if (!sess.wallPeakOI) sess.wallPeakOI = {};
    if (!sess.wallNegativeOIAlignedKeys) sess.wallNegativeOIAlignedKeys = {};
    if (!sess.wallInvalidForRejection) sess.wallInvalidForRejection = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};
    if (!sess.wallOIHistory) sess.wallOIHistory = {};
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

      if (ceOI !== undefined && ceOI > 0) {
        if (!sess.wallOIHistory[`${strike}_CE`]) sess.wallOIHistory[`${strike}_CE`] = [];
        const simTime = (this.state && this.state.nifty50 && this.state.nifty50.timestamp) ? this.state.nifty50.timestamp : Date.now();
        sess.wallOIHistory[`${strike}_CE`].push({ time: simTime, oi: ceOI });
        
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

      const ceSurrounding = [
        getOI(chainRows[i - 2], 'CE'),
        getOI(chainRows[i - 1], 'CE'),
        getOI(chainRows[i + 1], 'CE'),
        getOI(chainRows[i + 2], 'CE'),
      ];
      const peSurrounding = [
        getOI(chainRows[i - 2], 'PE'),
        getOI(chainRows[i - 1], 'PE'),
        getOI(chainRows[i + 1], 'PE'),
        getOI(chainRows[i + 2], 'PE'),
      ];

      if (
        ceOI === undefined ||
        peOI === undefined ||
        ceSurrounding.some((val) => val === undefined) ||
        peSurrounding.some((val) => val === undefined)
      ) {
        continue;
      }

      const ceOIAvgAdj = (ceSurrounding as number[]).reduce((sum, val) => sum + val, 0) / 4;
      if (ceOI > ceOIAvgAdj * 1.5) {
        candidateCEWallsList.push({ strike, type: 'CE', totalOI: ceOI, oiChange: ceOIC });
      }

      const peOIAvgAdj = (peSurrounding as number[]).reduce((sum, val) => sum + val, 0) / 4;
      if (peOI > peOIAvgAdj * 1.5) {
        candidatePEWallsList.push({ strike, type: 'PE', totalOI: peOI, oiChange: peOIC });
      }
    }

    return { candidateCEWallsList, candidatePEWallsList };
  }

  private async checkOpeningTrap(
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sess: LocalSessionState,
    wallAbove: number,
    wallBelow: number,
    passed: string[],
    failed: string[],
  ): Promise<InternalSignal | null> {
    if (!sess.openingRangeComplete) return null;
    const orHigh = sess.openingRangeHigh;
    const orLow = sess.openingRangeLow;
    if (orHigh <= 0 || orLow <= 0 || orHigh <= orLow) return null;

    const openingRangeBars = 3;
    if (candles.length <= openingRangeBars + 1) return null;

    const buffer = Math.max(2, Number(this.settings.RETEST_TOLERANCE_POINTS || 5));

    for (let breakIndex = openingRangeBars; breakIndex < candles.length - 2; breakIndex++) {
      const breakCandle = candles[breakIndex];
      
      for (
        let confirmationIndex = breakIndex + 2;
        confirmationIndex < candles.length;
        confirmationIndex++
      ) {
        const retestIndex = confirmationIndex - 1;
        const barsToRetest = retestIndex - breakIndex;
        if (barsToRetest < 1 || barsToRetest > 3) continue;

        const retestCandle = candles[retestIndex];
        const confirmationCandle = candles[confirmationIndex];

        const isCall =
          breakCandle.low < orLow &&
          retestCandle.low <= orLow + buffer &&
          retestCandle.close > orLow &&
          confirmationCandle.close > confirmationCandle.open &&
          confirmationCandle.close > orLow;

        const isPut =
          breakCandle.high > orHigh &&
          retestCandle.high >= orHigh - buffer &&
          retestCandle.close < orHigh &&
          confirmationCandle.close < confirmationCandle.open &&
          confirmationCandle.close < orHigh;

        if (!isCall && !isPut) continue;

        const direction = isCall ? 'CALL' : 'PUT';
        const level = isCall ? orLow : orHigh;
        const option = this.selectStrike(direction, spot, chainRows);
        if (!option) continue;

        const type = direction === 'CALL' ? 'CE' : 'PE';
        const expiry = this.settings.expiryDate || 'CURRENT';
        const breakPremium = this.getHistoricalPremium(option.strike, type, new Date(breakCandle.timestamp).toISOString(), expiry);
        const retestPremium = this.getHistoricalPremium(option.strike, type, new Date(retestCandle.timestamp).toISOString(), expiry);
        const confirmationPremium = this.getHistoricalPremium(option.strike, type, new Date(confirmationCandle.timestamp).toISOString(), expiry);
        
        if (breakPremium === undefined || retestPremium === undefined || confirmationPremium === undefined) {
          failed.push('FAILED_PREMIUM_ALIGNMENT: opening-trap history incomplete');
          continue;
        }

        const targets = this.computeSpotTargets(direction, spot, level, chainRows, sess, candles);
        if (!targets) continue;

        const setup: ProposedSetup = {
          direction,
          level,
          setupType: 'OPENING_TRAP',
          c0: confirmationCandle,
          c1: retestCandle,
          c2: breakCandle,
          target1: targets.target1Spot,
          target2: targets.target2Spot,
          stopLoss: targets.structuralStopSpot,
          breakCandleIndex: breakIndex,
          retestCandleIndex: retestIndex,
          confirmationCandleIndex: confirmationIndex,
          barsSinceBreakout: barsToRetest,
          barsSinceRetest: 1,
          premiumAtBreak: breakPremium,
          premiumAtRetestLow: retestPremium,
          premiumAtConfirmation: confirmationPremium,
          ceOpt: direction === 'CALL' ? option : undefined,
          peOpt: direction === 'PUT' ? option : undefined,
        };

        if (!this.validateCandidate(valCtx, setup, passed, failed)) continue;
        return this.createSignal(
          index,
          spot,
          'OPENING_TRAP',
          direction,
          level,
          chainRows,
          sess,
          passed,
          failed,
          setup,
          candles
        );
      }
    }
    return null;
  }

  private async checkOIWallRejection(
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sess: LocalSessionState,
    wallAbove: number,
    wallBelow: number,
    passed: string[],
    failed: string[],
  ): Promise<InternalSignal | null> {
    if (candles.length < 3) return null;
    const confirmation = candles[candles.length - 1];
    
    for (const wall of [wallAbove, wallBelow]) {
      if (!wall) continue;
      const isCeWall = wall === wallAbove;
      const direction = isCeWall ? 'PUT' : 'CALL';
      const key = this.wallHistoryKey(isCeWall ? 'CE' : 'PE', wall);
      const history = sess.wallOiHistory?.[key] || [];
      const recentPeak = history.length ? Math.max(...history) : NaN;
      
      const currentOi = this.readRequiredOi(
        chainRows.find((row: any) => Number(row.strike_price) === wall),
        isCeWall ? 'CE' : 'PE'
      );
      
      const wallStable =
        Number.isFinite(currentOi) &&
        Number.isFinite(recentPeak) &&
        (currentOi as number) >= (recentPeak as number) * 0.95;
      
      const tests = sess.wallTestCounts[wall] || 0;
      
      if (
        tests < 2 ||
        (sess.wallReactionCandleKeys[wall] || []).length < 1 ||
        !wallStable
      ) {
        continue;
      }

      // Check price has not closed through wall
      if (isCeWall && confirmation.close > wall) continue;
      if (!isCeWall && confirmation.close < wall) continue;
      
      const option = this.selectStrike(direction, spot, chainRows);
      if (!option) continue;
      const type = direction === 'CALL' ? 'CE' : 'PE';
      const expiry = this.settings.expiryDate || 'CURRENT';
      const premiumAtConfirmation = this.getHistoricalPremium(option.strike, type, new Date(confirmation.timestamp).toISOString(), expiry);
      const breakPremium = this.getHistoricalPremium(option.strike, type, new Date(candles[candles.length - 2].timestamp).toISOString(), expiry);

      if (premiumAtConfirmation === undefined || breakPremium === undefined) {
          failed.push('FAILED_PREMIUM_ALIGNMENT: wall-rejection history incomplete');
          continue;
      }

      const targets = this.computeSpotTargets(direction, spot, wall, chainRows, sess, candles);
      if (!targets) continue;

      const setup: ProposedSetup = {
        direction,
        level: wall,
        setupType: 'OI_WALL_REJECTION',
        c0: confirmation,
        c1: candles[candles.length - 2],
        c2: candles[candles.length - 3],
        target1: targets.target1Spot,
        target2: targets.target2Spot,
        stopLoss: targets.structuralStopSpot,
        premiumAtBreak: breakPremium,
        premiumAtConfirmation: premiumAtConfirmation,
        wallStable: true,
        ceOpt: direction === 'CALL' ? option : undefined,
        peOpt: direction === 'PUT' ? option : undefined,
        wallTestCount: tests
      };

      if (!this.validateCandidate(valCtx, setup, passed, failed)) continue;
      return this.createSignal(
        index,
        spot,
        'OI_WALL_REJECTION',
        direction,
        wall,
        chainRows,
        sess,
        passed,
        failed,
        setup,
        candles
      );
    }
    return null;
  }

  private async checkFailedRetest(
    direction: 'CALL' | 'PUT',
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sess: LocalSessionState,
    wallAbove: number,
    wallBelow: number,
    passed: string[],
    failed: string[],
  ): Promise<InternalSignal | null> {
    if (candles.length < 4) return null;

    const levels = this.validStructureLevels(sess);
    const buffer = Math.max(
      2,
      Number(this.settings.RETEST_TOLERANCE_POINTS || 5),
    );

    const firstBreakIndex = Math.max(1, candles.length - 8);

    for (
      let breakIndex = firstBreakIndex;
      breakIndex < candles.length - 2;
      breakIndex++
    ) {
      const breakCandle = candles[breakIndex];

      for (const level of levels) {
        const failedBreak =
          direction === 'CALL'
            ? breakCandle.close < level
            : breakCandle.close > level;

        if (!failedBreak) continue;

        for (
          let retestIndex = breakIndex + 1;
          retestIndex < Math.min(candles.length - 1, breakIndex + 5);
          retestIndex++
        ) {
          const barsToRetest = retestIndex - breakIndex;
          if (barsToRetest < 1 || barsToRetest > 4) continue;

          const retestCandle = candles[retestIndex];
          const confirmationIndex = retestIndex + 1;
          const confirmationCandle = candles[confirmationIndex];

          const validRetest =
            direction === 'CALL'
              ? retestCandle.low <= level + buffer &&
                retestCandle.close > level
              : retestCandle.high >= level - buffer &&
                retestCandle.close < level;

          const confirmed =
            direction === 'CALL'
              ? confirmationCandle.close > confirmationCandle.open &&
                confirmationCandle.close > level
              : confirmationCandle.close < confirmationCandle.open &&
                confirmationCandle.close < level;

          if (!validRetest || !confirmed) continue;

          const option = this.selectStrike(direction, spot, chainRows);
          if (!option) continue;

          const optionType = direction === 'CALL' ? 'CE' : 'PE';
          const expiry = this.settings.expiryDate || 'CURRENT';

          const premiumAtBreak =
            this.getHistoricalPremium(
              option.strike,
              optionType,
              new Date(breakCandle.timestamp).toISOString(),
              expiry,
            );

          const premiumAtRetestLow =
            this.getHistoricalPremium(
              option.strike,
              optionType,
              new Date(retestCandle.timestamp).toISOString(),
              expiry,
            );

          const premiumAtConfirmation =
            this.getHistoricalPremium(
              option.strike,
              optionType,
              new Date(confirmationCandle.timestamp).toISOString(),
              expiry,
            );

          if (
            premiumAtBreak === undefined ||
            premiumAtRetestLow === undefined ||
            premiumAtConfirmation === undefined
          ) {
            failed.push(
              'FAILED_PREMIUM_ALIGNMENT: failed-retest history incomplete',
            );
            continue;
          }

          const targets = this.computeSpotTargets(direction, spot, level, chainRows, sess, candles);

          if (!targets) continue;

          const setup: ProposedSetup = {
            direction,
            level,
            setupType: 'FAILED_RETEST',
            c0: confirmationCandle,
            c1: retestCandle,
            c2: breakCandle,
            target1: targets.target1Spot,
            target2: targets.target2Spot,
            stopLoss: targets.structuralStopSpot,
            breakCandleIndex: breakIndex,
            retestCandleIndex: retestIndex,
            confirmationCandleIndex: confirmationIndex,
            barsSinceBreakout: barsToRetest,
            barsSinceRetest: 1,
            premiumAtBreak,
            premiumAtRetestLow,
            premiumAtConfirmation,
            ceOpt: direction === 'CALL' ? option : undefined,
            peOpt: direction === 'PUT' ? option : undefined,
          };

          if (
            !this.validateCandidate(
              valCtx,
              setup,
              passed,
              failed,
            )
          ) {
            continue;
          }

          return this.createSignal(
            index,
            spot,
            'FAILED_RETEST',
            direction,
            level,
            chainRows,
            sess,
            passed,
            failed,
            setup,
            candles
          );
        }
      }
    }

    return null;
  }

  private async checkContinuation(
    setupType: 'CONTINUATION_BREAKOUT' | 'CONTINUATION_BREAKDOWN',
    direction: 'CALL' | 'PUT',
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sess: LocalSessionState,
    wallAbove: number,
    wallBelow: number,
    passed: string[],
    failed: string[],
  ): Promise<InternalSignal | null> {
    if (setupType === 'CONTINUATION_BREAKOUT' && direction !== 'CALL') {
      return null;
    }
    if (setupType === 'CONTINUATION_BREAKDOWN' && direction !== 'PUT') {
      return null;
    }

    if (candles.length < 3) return null;
    const levels = this.validStructureLevels(sess);

    for (let breakIndex = Math.max(0, candles.length - 6); breakIndex < candles.length - 1; breakIndex++) {
      const breakCandle = candles[breakIndex];
      for (const level of levels) {
        const isBreak =
          direction === 'CALL'
            ? breakCandle.close > level
            : breakCandle.close < level;
        
        if (!isBreak) continue;

        for (
          let confirmationIndex = breakIndex + 1;
          confirmationIndex < candles.length;
          confirmationIndex++
        ) {
          const barsSinceBreakout = confirmationIndex - breakIndex;
          if (barsSinceBreakout < 1 || barsSinceBreakout > 4) continue;

          const confirmation = candles[confirmationIndex];
          const staysBeyond = candles
            .slice(breakIndex + 1, confirmationIndex + 1)
            .every((candle) =>
              direction === 'CALL'
                ? candle.close > level
                : candle.close < level,
            );
          
          const firstImpulseRange = Math.abs(breakCandle.high - breakCandle.low);
          const moveFromLevel = Math.abs(confirmation.close - level);
          if (!staysBeyond || (firstImpulseRange > 0 && moveFromLevel > firstImpulseRange * 1.5)) {
            continue;
          }

          const confirmedDirection =
            direction === 'CALL'
              ? confirmation.close > confirmation.open
              : confirmation.close < confirmation.open;
          if (!confirmedDirection) continue;

          const option = this.selectStrike(direction, spot, chainRows);
          if (!option) continue;
          const type = direction === 'CALL' ? 'CE' : 'PE';
          const expiry = this.settings.expiryDate || 'CURRENT';

          const breakPremium = this.getHistoricalPremium(
            option.strike,
            type,
            new Date(breakCandle.timestamp).toISOString(),
            expiry,
          );
          const confirmationPremium = this.getHistoricalPremium(
            option.strike,
            type,
            new Date(confirmation.timestamp).toISOString(),
            expiry,
          );
          
          if (breakPremium === undefined || confirmationPremium === undefined) {
            failed.push('FAILED_PREMIUM_ALIGNMENT: continuation history incomplete');
            continue;
          }

          const pauseCandle = candles[breakIndex + 1];
          const pausePremium = this.getHistoricalPremium(
            option.strike,
            type,
            new Date(pauseCandle.timestamp).toISOString(),
            expiry,
          ) ?? breakPremium;

          const targets = this.computeSpotTargets(direction, spot, level, chainRows, sess, candles);
          if (!targets) continue;

          const setup: ProposedSetup = {
            direction,
            level,
            setupType,
            c0: confirmation,
            c1: candles[confirmationIndex - 1],
            c2: breakCandle,
            target1: targets.target1Spot,
            target2: targets.target2Spot,
            stopLoss: targets.structuralStopSpot,
            breakCandleIndex: breakIndex,
            confirmationCandleIndex: confirmationIndex,
            barsSinceBreakout,
            firstImpulseRange,
            moveFromBreakoutLevel: moveFromLevel,
            premiumAtBreak: breakPremium,
            premiumAtConfirmation: confirmationPremium,
            premiumBreakHigh: breakPremium * 1.02,
            premiumBreakMidpoint: breakPremium * 0.98,
            premiumPauseLow: pausePremium * 0.95,
            premiumConfirmationClose: confirmationPremium,
            premiumConfirmationHigh: confirmationPremium * 1.01,
            ceOpt: direction === 'CALL' ? option : undefined,
            peOpt: direction === 'PUT' ? option : undefined,
          };

          if (!this.validateCandidate(valCtx, setup, passed, failed)) continue;
          return this.createSignal(
            index,
            spot,
            setupType,
            direction,
            level,
            chainRows,
            sess,
            passed,
            failed,
            setup,
            candles
          );
        }
      }
    }
    return null;
  }

  private validateCandidate(
    valCtx: ValidationContext,
    setup: ProposedSetup,
    passed: string[],
    failed: string[],
  ): boolean {
    const selected = setup.direction === 'CALL' ? setup.ceOpt : setup.peOpt;
    const price = Number(selected?.price);
    const bid = Number(selected?.bidPrice);
    const ask = Number(selected?.askPrice);

    if (!Number.isFinite(price) || price <= 0) {
      failed.push('FAILED_LIQUIDITY: selected option premium unavailable');
      return false;
    }

    if (
      !Number.isFinite(bid) ||
      !Number.isFinite(ask) ||
      bid <= 0 ||
      ask < bid
    ) {
      failed.push('FAILED_LIQUIDITY: valid bid/ask unavailable');
      return false;
    }

    const spreadPercent = ((ask - bid) / price) * 100;
    if (
      !Number.isFinite(spreadPercent) ||
      spreadPercent > Number(this.settings.MAX_OPTION_SPREAD_PERCENT || 1.5)
    ) {
      failed.push(
        `FAILED_LIQUIDITY: spread ${spreadPercent.toFixed(2)}% too large`,
      );
      return false;
    }

    setup.spreadPercent = spreadPercent;

    const levels = this.validStructureLevels(valCtx.sessState);
    const result = runSetupValidation(
      valCtx,
      setup,
      [...levels, setup.level],
      setup.wallTestCount || 0,
    );
    if (!result.passed) {
      failed.push(result.reason || 'FAILED_SETUP_VALIDATION');
      return false;
    }
    passed.push(`Validated ${setup.setupType} with real premium/OI history`);
    return true;
  }
  
  private selectStrike(direction: 'CALL' | 'PUT', spot: number, chainRows: any[]) {
    // 3. Option Strike Selection (Moneyness Bands)
    // Find ATM
    let atmIndex = -1;
    let minDiff = Infinity;
    for (let i = 0; i < chainRows.length; i++) {
        const diff = Math.abs(Number(chainRows[i].strike_price) - spot);
        if (diff < minDiff) {
            minDiff = diff;
            atmIndex = i;
        }
    }
    
    if (atmIndex === -1) return undefined;
    
    // Allowed strikes: ATM, and 1 ITM.
    // For CALL, ITM is a lower strike price (usually lower index if sorted ascending).
    // For PUT, ITM is a higher strike price (usually higher index if sorted ascending).
    // Let's ensure chainRows is sorted just in case
    const sorted = [...chainRows].sort((a,b) => Number(a.strike_price) - Number(b.strike_price));
    let newAtmIndex = sorted.findIndex(r => Math.abs(Number(r.strike_price) - spot) === minDiff);
    
    let allowedRows = [];
    if (newAtmIndex !== -1) {
      allowedRows.push(sorted[newAtmIndex]); // ATM
      if (direction === 'CALL' && newAtmIndex > 0) {
         allowedRows.push(sorted[newAtmIndex - 1]); // 1 ITM (lower strike)
      } else if (direction === 'PUT' && newAtmIndex < sorted.length - 1) {
         allowedRows.push(sorted[newAtmIndex + 1]); // 1 ITM (higher strike)
      }
    }
    
    let bestOption = null;
    let bestSpread = Infinity;
    const maxSpread = Number(this.settings.MAX_OPTION_SPREAD_PERCENT || 1.5);
    
    for (const row of allowedRows) {
      const opt = direction === 'CALL' ? row.call_options : row.put_options;
      if (!opt) continue;
      
      const price = Number(opt.market_data?.ltp || opt.market_data?.last_price || 0);
      const bidPrice = Number(opt.market_data?.bid_price || opt.market_data?.bid || 0);
      const askPrice = Number(opt.market_data?.ask_price || opt.market_data?.ask || 0);
      
      if (price > 0 && bidPrice > 0 && askPrice >= bidPrice) {
         const spread = ((askPrice - bidPrice) / price) * 100;
         if (spread <= maxSpread && spread < bestSpread) {
            bestSpread = spread;
            bestOption = {
                strike: Number(row.strike_price),
                price, bidPrice, askPrice,
                instrumentKey: opt.instrument_key || ''
            };
         }
      }
    }
    
    return bestOption || undefined;
  }
  
  private getHistoricalPremium(
    strike: number,
    type: 'CE' | 'PE',
    timestamp: string,
    expiryDate?: string,
  ): number | undefined {
    const history = this.getOptionChainHistory ? this.getOptionChainHistory() : [];
    const targetMs = new Date(timestamp).getTime();
    
    const snapshots = history
      .filter((snapshot: any) =>
        (!expiryDate || expiryDate === 'CURRENT' || snapshot.expiryDate === expiryDate) &&
        snapshot.timestamp <= targetMs &&
        targetMs - snapshot.timestamp <= 180_000,
      )
      .sort((a: any, b: any) => b.timestamp - a.timestamp);

    const snapshot = snapshots[0];
    if (!snapshot) return undefined;
    
    if (Array.isArray(snapshot.rows)) {
      const row = snapshot.rows.find(
        (item: any) => Number(item.strike) === Number(strike),
      );
      if (!row) return undefined;
      const option = type === 'CE' ? row.ce : row.pe;
      const premium = Number(option?.ltp);
      return Number.isFinite(premium) && premium > 0 ? premium : undefined;
    } else if (Array.isArray(snapshot.data)) {
      const row = snapshot.data.find(
        (item: any) => Number(item.strike_price) === Number(strike),
      );
      if (!row) return undefined;
      const opt = type === 'CE' ? row.call_options : row.put_options;
      const premium = Number(opt?.market_data?.ltp ?? opt?.market_data?.last_price);
      return Number.isFinite(premium) && premium > 0 ? premium : undefined;
    }
    return undefined;
  }
  
  private computeSpotTargets(direction: 'CALL' | 'PUT', spot: number, level: number, chainRows: any[], sess: LocalSessionState, candles: Candle[]) {
    let buffer = this.settings.SL_BUFFER_POINTS || 10;
    
    const atrPeriod = (this.settings as any).CHOP_ATR_PERIOD || 14;
    const atrMultiplier = (this.settings as any).SL_BUFFER_ATR_MULTIPLIER || 0.5;
    
    if (candles && candles.length >= atrPeriod) {
      const atrArray = computeATR(
        candles.map((c) => c.high),
        candles.map((c) => c.low),
        candles.map((c) => c.close),
        atrPeriod
      );
      const currentAtr = atrArray[atrArray.length - 1];
      if (!isNaN(currentAtr)) {
        buffer = currentAtr * atrMultiplier;
      }
    }
    
    const stopLossSpot = direction === 'CALL' 
      ? Math.min(spot, level) - buffer 
      : Math.max(spot, level) + buffer;
      
    const risk = Math.max(buffer, Math.abs(spot - stopLossSpot));
    const reward = risk * 2;
    
    return {
        target1Spot: direction === 'CALL' ? spot + reward : spot - reward,
        target2Spot: direction === 'CALL' ? spot + reward * 2 : spot - reward * 2,
        structuralStopSpot: stopLossSpot
    };
  }

  private createSignal(
    index: string,
    spot: number,
    setupType: string,
    direction: 'CALL' | 'PUT',
    brokenLevel: number,
    chainRows: any[],
    sess: LocalSessionState,
    passed: string[],
    failed: string[],
    setup: ProposedSetup,
    candles: Candle[]
  ): InternalSignal | null {
    const targets = this.computeSpotTargets(direction, spot, brokenLevel, chainRows, sess, candles);
    if (!targets) return null;

    const opt = this.selectStrike(direction, spot, chainRows);
    if (!opt) {
      failed.push('FAILED_NO_STRIKE');
      return null;
    }
    const optionEntry = Number(opt.price);
    const lossPercent = this.settings.MAX_OPTION_LOSS_PERCENT || 35;
    const catastrophicOptionStoploss = Number(
      (optionEntry * (1 - lossPercent / 100)).toFixed(2),
    );

    const riskSpot = Math.abs(spot - targets.structuralStopSpot);
    let dynamicOptionRisk = riskSpot * 0.5; // Approx ATM delta mapped to option premium
    if (!Number.isFinite(dynamicOptionRisk) || dynamicOptionRisk < 5) {
      dynamicOptionRisk = 5;
    }

    if (!(optionEntry > 0) || !(dynamicOptionRisk > 0)) return null;

    // Logical multi-targets for Nifty:
    // Target 1: Base structural target (1.5x risk, min 14 pts on option premium)
    // Target 2: Extended trend runner target (3.0x risk, min 28 pts on option premium)
    // Strict Stoploss: Kept strictly unchanged (catastrophicOptionStoploss & structuralStopSpot)
    const optT1Delta = Math.max(dynamicOptionRisk * 1.5, 14);
    const optT2Delta = Math.max(dynamicOptionRisk * 3.0, 28);

    const prices = {
      spotEntry: spot,
      spotInvalidation: targets.structuralStopSpot,
      spotTarget1: targets.target1Spot,
      spotTarget2: targets.target2Spot,
      optionEntry,
      optionStoploss: catastrophicOptionStoploss,
      optionTarget1: Number((optionEntry + optT1Delta).toFixed(2)),
      optionTarget2: Number((optionEntry + optT2Delta).toFixed(2)),
    };

    const rewardSpot = Math.abs(prices.spotTarget1 - prices.spotEntry);
    if (!(riskSpot > 0) || rewardSpot / riskSpot < 0.8) {
      failed.push('FAILED_ROOM_TO_TARGET: Target 1 is less than 0.8R');
      return null;
    }

    const timeWindow = this.getTimeWindow(Date.now());

    let spreadPercent = 1.0;
    if (opt.price > 0 && opt.bidPrice > 0 && opt.askPrice >= opt.bidPrice) {
       spreadPercent = ((opt.askPrice - opt.bidPrice) / opt.price) * 100;
    }
    
    let premiumExpansion = 1.0;
    if (setup.premiumAtBreak > 0 && setup.premiumAtConfirmation > 0) {
       premiumExpansion = setup.premiumAtConfirmation / setup.premiumAtBreak;
    }

    let momentumScore = 1.0;
    const closes = candles.map(c => c.close);
    if (closes.length >= 14) {
       const rsiArr = computeRSI(closes, 14);
       const currentRSI = rsiArr[rsiArr.length - 1];
       if (!isNaN(currentRSI)) {
           // RSI > 60 is strong bullish, RSI < 40 is strong bearish
           if (direction === 'CALL') {
               momentumScore = currentRSI > 60 ? 1.5 : (currentRSI < 45 ? 0.5 : 1.0);
           } else {
               momentumScore = currentRSI < 40 ? 1.5 : (currentRSI > 55 ? 0.5 : 1.0);
           }
       }
    }

    let oiStateScore = 1.5; // 1.5 is neutral in confidence.ts
    if (sess.nearestCeWallAbove && sess.nearestPeWallBelow) {
       const ceWallOi = sess.wallOiHistory?.[`CE_${sess.nearestCeWallAbove}`]?.[0] || 0;
       const peWallOi = sess.wallOiHistory?.[`PE_${sess.nearestPeWallBelow}`]?.[0] || 0;
       
       if (ceWallOi > 0 && peWallOi > 0) {
           const ratio = direction === 'CALL' ? peWallOi / ceWallOi : ceWallOi / peWallOi;
           oiStateScore = ratio > 1.2 ? 2.5 : (ratio < 0.8 ? 1.0 : 1.5);
       }
    }

    const conf = calculateConfidence({
      rewardRiskRatio: rewardSpot / riskSpot,
      premiumExpansion,
      oiState: oiStateScore,
      spreadPercent,
      ivRegime: 1.0,
      momentum: momentumScore,
      gapState: 0,
      timeWindow,
      isExpiryAfter14: false,
      feedSyncPenalty: sess.feedSyncPenalty || 0
    });

    const optionData = {
      price: opt.price,
      instrumentKey: opt.instrumentKey,
    };

    let signal: InternalSignal | null = null;
    switch (setupType) {
      case 'OPENING_TRAP':
        signal = StrategySignalsGenerator.generateOpeningTrapSignal(
          index, spot, brokenLevel, direction, candles, setup, optionData, conf, passed
        );
        break;
      case 'FAILED_RETEST':
        signal = StrategySignalsGenerator.generateFailedRetestSignal(
          index, spot, brokenLevel, direction, candles, setup, optionData, conf, passed
        );
        break;
      case 'CONTINUATION_BREAKOUT':
      case 'CONTINUATION_BREAKDOWN':
        signal = StrategySignalsGenerator.generateContinuationSignal(
          index, spot, brokenLevel, direction, setupType as any, candles, setup, optionData, conf, passed
        );
        break;
      case 'OI_WALL_REJECTION':
        signal = StrategySignalsGenerator.generateWallRejectionSignal(
          index, spot, brokenLevel, direction, candles, setup, optionData, conf, passed
        );
        break;
    }

    if (signal) {
      return signal;
    }

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
      entry: prices.optionEntry,
      entryPrice: prices.optionEntry,
      stoploss: prices.optionStoploss,
      target1: prices.optionTarget1,
      target2: prices.optionTarget2,
      broken_level: brokenLevel,
      optionEntry: prices.optionEntry,
      optionStoploss: prices.optionStoploss,
      optionTarget1: prices.optionTarget1,
      optionTarget2: prices.optionTarget2,
      spot,
      confidence: conf,
      reason: passed,
      status: 'ACTIVE',
      highestPrice: optionEntry,
      latestSpot: spot,
      latestSpotTimestamp: this.state.nifty50?.timestamp || Date.now(),
      latestOptionTimestamp: this.state.nifty50?.timestamp || Date.now(),
      entryTime: this.state.nifty50?.timestamp || Date.now()
    } as any;
  }

  private manageActiveTrades(newSignals: InternalSignal[]) {
    let nseDayEndClose = false;
    let mcxDayEndClose = false;
    try {
      const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const istDate = new Date(istString);
      const totalMins = istDate.getHours() * 60 + istDate.getMinutes();
      // Auto square-off before market close (Strictly no overnight positions carried)
      // NSE trades square-off at or after 15:20 IST
      if (totalMins >= 15 * 60 + 20) nseDayEndClose = true;
      // MCX Gold trades square-off at or after 23:20 IST
      if (totalMins >= 23 * 60 + 20) mcxDayEndClose = true;
    } catch (_) {}

    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'CLOSED') {
        this.activeSignals.delete(id);
        continue;
      }

      // Handle GOLD active trade management (Rob Booker - ADX Breakout)
      if (signal.index === 'GOLD') {
        const curPrice = Number(this.state.gold?.lastPrice || signal.latestPrice || signal.entryPrice);
        signal.latestPrice = curPrice;

        // Day end square-off: Never carry gold position overnight
        if (mcxDayEndClose) {
          this.closeSignal(signal, curPrice, 'DAY END CLOSE: Square-off before session end (No overnight carry)');
          newSignals.push(signal);
          continue;
        }

        const isLong = signal.signal === 'BUY' || signal.direction === 'CALL';
        if (isLong) {
          // Dynamic Breakeven Lock: At 50% target progress, lock stoploss to entry
          if (!signal.isBreakevenLocked) {
            const favorableMove = curPrice - signal.entryPrice;
            const targetDistance = signal.target - signal.entryPrice;
            if (targetDistance > 0 && favorableMove >= targetDistance * 0.5) {
              signal.stoploss = Math.max(signal.stoploss, signal.entryPrice);
              signal.isBreakevenLocked = true;
            }
          }

          if (curPrice >= signal.target) {
            this.closeSignal(signal, signal.target, 'TARGET REACHED (close_long)');
            newSignals.push(signal);
            continue;
          } else if (curPrice <= signal.stoploss) {
            const exitReason = signal.isBreakevenLocked ? 'BREAKEVEN PROTECTED (close_long)' : 'STOPLOSS HIT (close_long)';
            this.closeSignal(signal, signal.stoploss, exitReason);
            newSignals.push(signal);
            continue;
          }
        } else {
          // Dynamic Breakeven Lock: At 50% target progress, lock stoploss to entry
          if (!signal.isBreakevenLocked) {
            const favorableMove = signal.entryPrice - curPrice;
            const targetDistance = signal.entryPrice - signal.target;
            if (targetDistance > 0 && favorableMove >= targetDistance * 0.5) {
              signal.stoploss = Math.min(signal.stoploss, signal.entryPrice);
              signal.isBreakevenLocked = true;
            }
          }

          if (curPrice <= signal.target) {
            this.closeSignal(signal, signal.target, 'TARGET REACHED (close_short)');
            newSignals.push(signal);
            continue;
          } else if (curPrice >= signal.stoploss) {
            const exitReason = signal.isBreakevenLocked ? 'BREAKEVEN PROTECTED (close_short)' : 'STOPLOSS HIT (close_short)';
            this.closeSignal(signal, signal.stoploss, exitReason);
            newSignals.push(signal);
            continue;
          }
        }
        continue;
      }

      const currentOptPrice = Number(signal.latestPrice ?? signal.optionEntry);
      const currentSpot = Number(this.state.nifty50.lastPrice);

      // Dedicated Exit Rules for Combo Strategies (Filtered & Unfiltered)
      if (signal.strategy_family === 'COMBO_FILTERED' || signal.strategy_family === 'COMBO_UNFILTERED') {
        const entryTs = signal.entryTime || (typeof signal.timestamp === 'string' ? new Date(signal.timestamp).getTime() : signal.timestamp) || Date.now();
        const elapsedMins = Math.max(0, (Date.now() - entryTs) / 60000);
        const maxMins = (this.settings as any).maxTradeDurationMinutes || 60;
        if (elapsedMins >= maxMins) {
          const blendedExit = signal.firstTargetHitFlag ? Number(((signal.optionTarget1 + currentOptPrice) / 2).toFixed(2)) : currentOptPrice;
          this.closeSignal(signal, blendedExit, `MAX TRADE DURATION EXPIRED (${maxMins}m limit reached)`);
          newSignals.push(signal);
          continue;
        }

        // Opposite Signal / Trend Reversal Exit
        const candles = (this.state.nifty50 as any)?.candles1m || [];
        if (candles.length >= 15) {
          const highs = candles.map((c: any) => c.high);
          const lows = candles.map((c: any) => c.low);
          const closes = candles.map((c: any) => c.close);
          const vols = candles.map((c: any) => c.volume || 1);
          const alpha = computeAlphaTrend(highs, lows, closes, vols, 14, 1.0, false);
          const t3 = computeT3(closes, 14, 0.7);
          const lastIdx = candles.length - 1;
          const isBearishReversal = alpha.sellSignal[lastIdx] || (t3.lev0[lastIdx - 1] >= t3.lev5[lastIdx - 1] && t3.lev0[lastIdx] < t3.lev5[lastIdx]);
          const isBullishReversal = alpha.buySignal[lastIdx] || (t3.lev0[lastIdx - 1] <= t3.lev5[lastIdx - 1] && t3.lev0[lastIdx] > t3.lev5[lastIdx]);

          if (signal.direction === 'CALL' && isBearishReversal) {
            const blendedExit = signal.firstTargetHitFlag ? Number(((signal.optionTarget1 + currentOptPrice) / 2).toFixed(2)) : currentOptPrice;
            this.closeSignal(signal, blendedExit, 'OPPOSITE SIGNAL REVERSAL: AlphaTrend / T3 Bearish Reversal');
            newSignals.push(signal);
            continue;
          }
          if (signal.direction === 'PUT' && isBullishReversal) {
            const blendedExit = signal.firstTargetHitFlag ? Number(((signal.optionTarget1 + currentOptPrice) / 2).toFixed(2)) : currentOptPrice;
            this.closeSignal(signal, blendedExit, 'OPPOSITE SIGNAL REVERSAL: AlphaTrend / T3 Bullish Reversal');
            newSignals.push(signal);
            continue;
          }
        }
      } else if (signal.strategy_family === 'MACD_ADAPTIVE_SUPERTREND') {
        const entryTs = signal.entryTime || (typeof signal.timestamp === 'string' ? new Date(signal.timestamp).getTime() : signal.timestamp) || Date.now();
        const elapsedMins = Math.max(0, (Date.now() - entryTs) / 60000);
        const maxMins = (this.settings as any).maxTradeDurationMinutes || 60;
        if (elapsedMins >= maxMins) {
          const blendedExit = signal.firstTargetHitFlag ? Number(((signal.optionTarget1 + currentOptPrice) / 2).toFixed(2)) : currentOptPrice;
          this.closeSignal(signal, blendedExit, `MAX TRADE DURATION EXPIRED (${maxMins}m limit reached)`);
          newSignals.push(signal);
          continue;
        }

        // MACD + Adaptive SuperTrend Reversal Exit
        const candles = (this.state.nifty50 as any)?.candles1m || [];
        if (candles.length >= 25) {
          const strat = new NiftyMacdAdaptiveSupertrend({
            macdFast: 12,
            macdSlow: 26,
            macdSignal: 9,
            atrPeriod: 10,
            superTrendMultiplier: 3,
            enableAdaptiveMultiplier: true,
          });
          for (const c of candles) {
            strat.updatePriceData(c);
          }
          const macd = strat.calculateMACD(strat.priceData.close);
          const supertrend = strat.calculateAdaptiveSupertrend(
            strat.priceData.high,
            strat.priceData.low,
            strat.priceData.close,
            strat.priceData.volume
          );
          if (macd && supertrend) {
            const isBearishReversal = supertrend.trend === 'downtrend' || (macd.macdPrev > macd.signalPrev && macd.macdLine < macd.signalLine);
            const isBullishReversal = supertrend.trend === 'uptrend' || (macd.macdPrev < macd.signalPrev && macd.macdLine > macd.signalLine);

            if (signal.direction === 'CALL' && isBearishReversal) {
              const blendedExit = signal.firstTargetHitFlag ? Number(((signal.optionTarget1 + currentOptPrice) / 2).toFixed(2)) : currentOptPrice;
              this.closeSignal(signal, blendedExit, 'OPPOSITE REVERSAL: MACD / Adaptive SuperTrend Bearish Reversal');
              newSignals.push(signal);
              continue;
            }
            if (signal.direction === 'PUT' && isBullishReversal) {
              const blendedExit = signal.firstTargetHitFlag ? Number(((signal.optionTarget1 + currentOptPrice) / 2).toFixed(2)) : currentOptPrice;
              this.closeSignal(signal, blendedExit, 'OPPOSITE REVERSAL: MACD / Adaptive SuperTrend Bullish Reversal');
              newSignals.push(signal);
              continue;
            }
          }
        }
      }

      // Day end square-off: Never carry Nifty position overnight
      if (nseDayEndClose) {
        if (signal.firstTargetHitFlag) {
          const blendedExit = Number(((signal.optionTarget1 + currentOptPrice) / 2).toFixed(2));
          this.closeSignal(signal, blendedExit, 'DAY END CLOSE: Target 1 Secured (No Overnight Carry)');
        } else {
          this.closeSignal(signal, currentOptPrice, 'DAY END CLOSE: Square-off before session end (No overnight carry)');
        }
        newSignals.push(signal);
        continue;
      }
      const isCall = signal.direction === 'CALL';
      const spotInvalidation = signal.spotInvalidation;

      // Target 1 Evaluation: Lock partial profit and strictly shift stoploss to breakeven (+ buffer)
      const spotHitT1 = isCall ? currentSpot >= signal.spotTarget1 : currentSpot <= signal.spotTarget1;
      const optHitT1 = currentOptPrice >= signal.optionTarget1;

      if (!signal.firstTargetHitFlag && (optHitT1 || spotHitT1)) {
        signal.firstTargetHitFlag = true;
        signal.partialExit = true;
        signal.isBreakevenLocked = true;
        // Strictly protect trade: ratchet stoploss to entry (+1.0 pt BE buffer to eliminate risk)
        signal.optionStoploss = Math.max(signal.optionStoploss, signal.optionEntry + 1.0);
        signal.stoploss = signal.optionStoploss;
      }

      // Target 2 Evaluation: Runner reached full extended profit target!
      const spotHitT2 = isCall ? currentSpot >= signal.spotTarget2 : currentSpot <= signal.spotTarget2;
      const optHitT2 = currentOptPrice >= signal.optionTarget2;

      if (optHitT2 || spotHitT2) {
        signal.secondTargetHitFlag = true;
        signal.isParabolic = true;
        // Multi-target completion: 50% booked at Target 1, 50% booked at Target 2
        const blendedExit = Number(((signal.optionTarget1 + signal.optionTarget2) / 2).toFixed(2));
        this.closeSignal(signal, blendedExit, 'TARGET 2 REACHED (Multi-Target TP2 Complete)');
        newSignals.push(signal);
        continue;
      }

      const structuralInvalidation = isCall
        ? currentSpot <= spotInvalidation
        : currentSpot >= spotInvalidation;
      
      if (structuralInvalidation) {
        if (signal.firstTargetHitFlag) {
          const blendedExit = Number(((signal.optionTarget1 + currentOptPrice) / 2).toFixed(2));
          this.closeSignal(signal, blendedExit, 'TARGET 1 SECURED (Spot Retraced)');
        } else {
          this.closeSignal(signal, currentOptPrice, 'SPOT STRUCTURAL INVALIDATION');
        }
        newSignals.push(signal);
        continue;
      }

      if (currentOptPrice <= signal.optionStoploss) {
        if (signal.firstTargetHitFlag) {
          // Target 1 was secured; runner exited at protected breakeven/trail stop (positive net PnL, win preserved)
          const blendedExit = Number(((signal.optionTarget1 + signal.optionStoploss) / 2).toFixed(2));
          this.closeSignal(signal, blendedExit, 'TARGET 1 SECURED (Runner BE Protected)');
        } else {
          this.closeSignal(signal, signal.optionStoploss, 'OPTION PREMIUM STOPLOSS');
        }
        newSignals.push(signal);
        continue;
      }

      const optionRisk = signal.optionTarget1 - signal.optionEntry;
      if (signal.firstTargetHitFlag && optionRisk > 0) {
         if (signal.strategy_family === 'COMBO_FILTERED') {
           // PDF Section 4 Trailing Stop Loss Mechanics:
           // Trails at 50% of maximum risk distance behind peak price
           const peakPrice = Number((signal as any).peakPrice || signal.latestPrice || signal.optionEntry);
           const dynamicTrailStop = Number((peakPrice - 0.5 * optionRisk).toFixed(2));
           if (dynamicTrailStop > signal.optionStoploss) {
             signal.optionStoploss = dynamicTrailStop;
             signal.stoploss = dynamicTrailStop;
           }
         } else if (signal.strategy_family === 'COMBO_UNFILTERED' || signal.strategy_family === 'MACD_ADAPTIVE_SUPERTREND') {
           // Unfiltered / MACD+ST: Breakeven lock is already set upon Target 1, no other strategy rules apply
         } else {
         // 5. Market Structure (Swing) Trailing Stop-Loss
         const candles = (this.state.nifty50 as any)?.candles1m || [];
         const entryTime = signal.entryTime || (signal.latestOptionTimestamp - 100000000); // fallback
         if (candles.length >= 3) {
            let atrBuffer = 5;
            const atrPeriod = (this.settings as any).CHOP_ATR_PERIOD || 14;
            const atrMultiplier = (this.settings as any).SL_BUFFER_ATR_MULTIPLIER || 0.5;
            if (candles.length >= atrPeriod) {
               const atrArray = computeATR(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), atrPeriod);
               const currentAtr = atrArray[atrArray.length - 1];
               if (!isNaN(currentAtr)) atrBuffer = currentAtr * atrMultiplier;
            }

            
            let parabolicAtrBuffer = 10;
            if (candles.length >= atrPeriod) {
               const atrArray = computeATR(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), atrPeriod);
               const currentAtr = atrArray[atrArray.length - 1];
               if (!isNaN(currentAtr)) {
                   parabolicAtrBuffer = currentAtr * 1.5; // 1.5x ATR for parabolic
               }
            }

            if (isCall) {
               // A. Parabolic ATR Trail
               let parabolicStop = -Infinity;
               if (signal.isParabolic) {
                   const highestSpotSinceEntry = Math.max(...candles.filter((c) => {
                       const cTs = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
                       return cTs >= entryTime;
                   }).map((c) => c.high));
                   parabolicStop = highestSpotSinceEntry - parabolicAtrBuffer;
               }

               // B. Swing Low Trail
               let highestSwingLow = -Infinity;
               for (let i = 2; i < candles.length - 1; i++) {
                  const cTime = typeof candles[i-1].timestamp === 'string' ? new Date(candles[i-1].timestamp).getTime() : candles[i-1].timestamp;
                  if (cTime >= entryTime && candles[i-1].low < candles[i-2].low && candles[i-1].low < candles[i].low) {
                     highestSwingLow = Math.max(highestSwingLow, candles[i-1].low);
                  }
               }
               
               let swingStop = -Infinity;
               if (highestSwingLow !== -Infinity) {
                  swingStop = highestSwingLow - atrBuffer;
               }

               const bestStop = Math.max(swingStop, parabolicStop, signal.spotInvalidation);
               if (bestStop > signal.spotInvalidation) {
                   signal.spotInvalidation = bestStop;
               }
            } else {
               // A. Parabolic ATR Trail
               let parabolicStop = Infinity;
               if (signal.isParabolic) {
                   const lowestSpotSinceEntry = Math.min(...candles.filter((c) => {
                       const cTs = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
                       return cTs >= entryTime;
                   }).map((c) => c.low));
                   parabolicStop = lowestSpotSinceEntry + parabolicAtrBuffer;
               }

               // B. Swing High Trail
               let lowestSwingHigh = Infinity;
               for (let i = 2; i < candles.length - 1; i++) {
                  const cTime = typeof candles[i-1].timestamp === 'string' ? new Date(candles[i-1].timestamp).getTime() : candles[i-1].timestamp;
                  if (cTime >= entryTime && candles[i-1].high > candles[i-2].high && candles[i-1].high > candles[i].high) {
                     lowestSwingHigh = Math.min(lowestSwingHigh, candles[i-1].high);
                  }
               }
               
               let swingStop = Infinity;
               if (lowestSwingHigh !== Infinity) {
                  swingStop = lowestSwingHigh + atrBuffer;
               }

               const bestStop = Math.min(swingStop, parabolicStop, signal.spotInvalidation);
               if (bestStop < signal.spotInvalidation) {
                   signal.spotInvalidation = bestStop;
               }
            }
         }
         
         // Still fallback trail the option premium to lock profits just in case gamma is wild
         if (signal.highestPrice > signal.optionEntry) {
            const candidate = Number((signal.highestPrice - optionRisk * 0.5).toFixed(2));
            if (candidate > signal.optionStoploss) {
               signal.optionStoploss = candidate;
               signal.stoploss = candidate;
            }
         }
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
      }
    }

    signal.status = 'CLOSED';
    signal.latestPrice = exitPrice;
    const isShort = signal.signal === 'SELL' || signal.direction === 'PUT';
    const entry = (signal.optionEntry || signal.entryPrice);
    signal.realizedPnL = isShort ? (entry - exitPrice) : (exitPrice - entry);
    signal.exitReason = reason;
    
    this.realizedPnL += signal.realizedPnL;
    
    this.history.set(signal.id, signal);
    
    // Prevent memory leaks for 24/7 operation by bounding the history map
    if (this.history.size > 500) {
      const oldestKey = this.history.keys().next().value;
      if (oldestKey) {
        this.history.delete(oldestKey);
      }
    }
    
    this.activeSignals.delete(signal.id);
  }

  private mapToPublicDecision(sig: InternalSignal | any): EngineDecision {
    return {
      timestamp: sig.timestamp || new Date().toISOString(),
      signal: sig.signal || 'NO_TRADE',
      strategy_family: (sig.strategy_family || 'NONE') as any,
      direction: (sig.direction || 'NONE') as any,
      entry: sig.optionEntry || sig.entry || 0,
      stoploss: sig.optionStoploss || sig.stoploss || 0,
      target1: sig.optionTarget1 || sig.target1 || 0,
      target2: sig.optionTarget2 || sig.target2 || 0,
      spot_entry: sig.spotEntry,
      spot_invalidation: sig.spotInvalidation,
      spot_target1: sig.spotTarget1,
      spot_target2: sig.spotTarget2,
      option_entry: sig.optionEntry,
      option_stoploss: sig.optionStoploss,
      option_target1: sig.optionTarget1,
      option_target2: sig.optionTarget2,
      confidence: sig.confidence || 0,
      reason: [(sig.reason || []).join(' | ')] as any,
      instrumentKey: sig.instrumentKey || ''
    };
  }

  

  private createNoTrade(index: string, spot: number, failReason: string): EngineDecision {
    return {
      timestamp: new Date().toISOString(),
      signal: 'NO_TRADE',
      strategy_family: 'NONE' as any,
      direction: 'NONE' as any,
      option_type: 'NONE' as any,
      spot_entry: spot,
      spot_invalidation: 0,
      spot_target1: 0,
      spot_target2: 0,
      option_entry: 0,
      option_stoploss: 0,
      option_target1: 0,
      option_target2: 0,
      entry: 0,
      stoploss: 0,
      target1: 0,
      target2: 0,
      confidence: 0,
      reason: [failReason] as any,
      instrumentKey: ''
    };
  }

  public exitAllActiveTrades(reason: string) {
    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'ACTIVE') {
        const curPrice = signal.latestPrice || signal.optionEntry || signal.entryPrice;
        this.closeSignal(signal, curPrice, reason);
      }
    }
  }

  public reset() {
    this.sessionStates = {};
    this.activeSignals.clear();
    this.history.clear();
  }

  public getTimeWindow(nowMs: number): string {
    const d = new Date(nowMs);
    const h = Number(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }));
    const m = Number(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', minute: 'numeric' }));
    const timeNum = h * 100 + m;

    if (timeNum >= 915 && timeNum < 920) return '09:15-09:20';
    if (timeNum >= 920 && timeNum < 1000) return '09:20-10:00';
    if (timeNum >= 1000 && timeNum < 1230) return '10:00-12:30';
    if (timeNum >= 1230 && timeNum < 1330) return '12:30-13:30';
    if (timeNum >= 1330 && timeNum < 1500) return '13:30-15:00';
    return 'POST-15:00';
  }
}
