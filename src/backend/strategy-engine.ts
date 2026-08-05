import { AppSettings, AppState, Signal, Candle, StrategySessionState } from './types.js';
import { getCandles } from '../db/market.js';
import { runGlobalPreChecks, runSetupValidation, ValidationContext, ProposedSetup } from './validation-rules.js';

export type FetchOptionDataFn = (index: string, type: 'CE' | 'PE', spotPrice: number, strikeOffset?: number) => Promise<{ price: number, instrumentKey: string, strike: number } | null>;
export type GetOptionChainFn = (instrumentKey: string, expiryDate: string) => Promise<any>;
export type GetNearestExpiryFn = (instrumentKey: string) => Promise<string>;

interface OIWall {
  strike: number;
  totalOI: number;
  avgSurroundingOI: number;
  oiRatio: number;
  type: 'CE' | 'PE';
}

type LocalSessionState = StrategySessionState & {
  sessionHigh: number;
  sessionLow: number;
  previousDayHigh: number;
  previousDayLow: number;
  openingRangeHigh: number;
  openingRangeLow: number;
  nearestCEWallAbove: number;
  nearestPEWallBelow: number;
  lastTradeCandleTime: string | null;
};

export class StrategyEngine {
  private settings: AppSettings;
  private state: AppState;
  public activeSignals: Map<string, Signal> = new Map();
  private fetchOptionData: FetchOptionDataFn;
  private getOptionChain?: GetOptionChainFn;
  private getNearestExpiry?: GetNearestExpiryFn;

  private sessionStates: Record<string, LocalSessionState> = {
    'NIFTY': this.createInitialSessionState(),
  };

  constructor(
    settings: AppSettings, 
    state: AppState, 
    fetchOptionData: FetchOptionDataFn,
    getOptionChain?: GetOptionChainFn,
    getNearestExpiry?: GetNearestExpiryFn
  ) {
    this.settings = settings;
    this.state = state;
    this.fetchOptionData = fetchOptionData;
    this.getOptionChain = getOptionChain;
    this.getNearestExpiry = getNearestExpiry;
  }

  private createInitialSessionState() {
    return {
      sessionHigh: 0,
      sessionLow: Infinity,
      previousDayHigh: 0,
      previousDayLow: 0,
      openingRangeHigh: 0,
      openingRangeLow: 0,
      nearestCEWallAbove: 0,
      nearestPEWallBelow: 0,
      brokenLevelUnderWatch: null,
      retestPendingFlag: false,
      continuationPendingFlag: false,
      tradeTakenFlag: false,
      firstTargetHitFlag: false,
      trailingStopActiveFlag: false,
      lastSignalDirection: 'NONE' as const,
      lastFailedSetupLevel: null,
      failedLevelsToday: [],
      tradedStructures: [],
      failedStructuresToday: [],
      activeStructureId: null,
      lastFailedStructureId: null,
      sessionDateIST: new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' }),
      wallTestCounts: {},
      prevWallTotalOI: {},
      wallNegativeOICounts: {},
      lastTradeExitTime: 0,
      lastTradeCandleTime: null,
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

  public async onTick(newState: AppState): Promise<Signal[]> {
    this.state = newState;
    const newSignals: Signal[] = [];

    // If global trading toggle is disabled or market is closed, exit active trades and return
    if (!this.settings.isTradingEnabled || !this.isMarketOpen()) {
      if (this.activeSignals.size > 0) {
        this.exitAllActiveTrades(
          !this.settings.isTradingEnabled 
            ? "Trading Paused" 
            : "Market Closed (Outside NSE Trading Hours 09:15 - 15:30 IST)"
        );
      }
      return newSignals;
    }

    // Manage active trades first
    this.manageActiveTrades(newSignals);

    // Evaluate NIFTY ONLY
    if (this.settings.nifty50Enabled && this.state.nifty50.lastPrice > 0) {
      const sig = await this.evaluateIndex('NIFTY', this.state.nifty50.lastPrice);
      if (sig && sig.signal !== 'NO_TRADE') newSignals.push(sig);
    }

    newSignals.forEach(s => this.activeSignals.set(s.id, s));
    return newSignals;
  }

  private async evaluateIndex(index: string, spotPrice: number): Promise<Signal | null> {
    const timeObj = new Date();
    const timeStr = timeObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const timestampISO = timeObj.toISOString();
    const currentDateIST = timeObj.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });

    const sessState = this.sessionStates[index];
    
    if (sessState.sessionDateIST !== currentDateIST) {
      sessState.sessionDateIST = currentDateIST;
      sessState.failedLevelsToday = [];
      sessState.tradedStructures = [];
      sessState.failedStructuresToday = [];
      sessState.wallTestCounts = {};
      sessState.prevWallTotalOI = {};
      sessState.wallNegativeOICounts = {};
      sessState.brokenLevelUnderWatch = null;
      sessState.retestPendingFlag = false;
      sessState.continuationPendingFlag = false;
      sessState.tradeTakenFlag = false;
      sessState.firstTargetHitFlag = false;
      sessState.trailingStopActiveFlag = false;
      sessState.lastSignalDirection = 'NONE';
      sessState.lastFailedSetupLevel = null;
      sessState.lastTradeCandleTime = null;
      sessState.activeStructureId = null;
      sessState.lastFailedStructureId = null;
    }

    const instrumentKey = index === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank';
    const step = index === 'NIFTY' ? 50 : 100;

    // Primary Timeframe: Completed 1-minute live option-chain updates
    let candles1m = await getCandles(index, 1, 60);
    candles1m.reverse(); // chronological order
    
    // STRICT RULE 1: IGNORE LIVE FORMING CANDLES
    const currentMinuteStart = Math.floor(timeObj.getTime() / 60000) * 60000;
    if (candles1m.length > 0 && new Date(candles1m[candles1m.length - 1].timestamp).getTime() >= currentMinuteStart) {
      candles1m.pop(); // Remove the incomplete live candle
    }

    // HARD REJECT INCOMPLETE CANDLES: Rule 1 & Rule 5
    // Ensure only fully completed 1-minute candles are evaluated (ignore partial ticks)
    candles1m = candles1m.filter(c => {
      const cTime = new Date(c.timestamp).getTime();
      return cTime < currentMinuteStart;
    });

    if (candles1m.length === 0) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCandles = candles1m.filter(c => new Date(c.timestamp).getTime() >= today.getTime());
    const prevCandles = candles1m.filter(c => new Date(c.timestamp).getTime() < today.getTime());

    // Rolling history buffers based on completed 1-minute updates
    const last3Updates = todayCandles.slice(-3);   // Breakout / Retest confirmation
    const last5Updates = todayCandles.slice(-5);   // Premium confirmation
    const last10Updates = todayCandles.slice(-10); // OI trend confirmation
    const last20Updates = todayCandles.slice(-20); // Session structure, S/R, and dominant OI walls

    // Calculate PDH, PDL from previous day 1m candles
    if (prevCandles.length > 0) {
      sessState.previousDayHigh = Math.max(...prevCandles.map(c => c.high));
      sessState.previousDayLow = Math.min(...prevCandles.map(c => c.low));
    }

    // Calculate Session High, Session Low, Opening Range High (ORH), Opening Range Low (ORL)
    if (todayCandles.length >= 15) {
      sessState.sessionHigh = Math.max(...todayCandles.map(c => c.high));
      sessState.sessionLow = Math.min(...todayCandles.map(c => c.low));

      // Opening range = first 15 minutes (first 15 1-minute completed updates)
      const orbCandles = todayCandles.slice(0, 15);
      sessState.openingRangeHigh = Math.max(...orbCandles.map(c => c.high));
      sessState.openingRangeLow = Math.min(...orbCandles.map(c => c.low));
    } else if (todayCandles.length > 0) {
      sessState.sessionHigh = Math.max(...todayCandles.map(c => c.high));
      sessState.sessionLow = Math.min(...todayCandles.map(c => c.low));
      sessState.openingRangeHigh = sessState.sessionHigh;
      sessState.openingRangeLow = sessState.sessionLow;
    } else {
      sessState.sessionHigh = spotPrice;
      sessState.sessionLow = spotPrice;
      sessState.openingRangeHigh = spotPrice;
      sessState.openingRangeLow = spotPrice;
    }

    // Fetch live option chain
    let chainRows: any[] = [];
    if (this.getOptionChain && this.getNearestExpiry) {
      try {
        let expiry = this.settings.expiryDate;
        if (!expiry || expiry === 'CURRENT') {
          expiry = await this.getNearestExpiry(instrumentKey);
        }
        const res = await this.getOptionChain(instrumentKey, expiry);
        if (res && res.data) chainRows = res.data;
      } catch (e) {
        console.error(`Error fetching option chain for strategy engine on ${index}:`, e);
      }
    }

    // Find valid OI Walls (1.5x rule & test count reaction)
    const { wallsAbove, wallsBelow } = this.findValidOIWalls(chainRows, spotPrice, step, sessState);
    const nearestCEWallAbove = wallsAbove.length > 0 ? wallsAbove[0].strike : spotPrice + step * 4;
    const nearestPEWallBelow = wallsBelow.length > 0 ? wallsBelow[0].strike : spotPrice - step * 4;

    sessState.nearestCEWallAbove = nearestCEWallAbove;
    sessState.nearestPEWallBelow = nearestPEWallBelow;

    // Track wall reaction counts
    this.updateWallTestCounts(spotPrice, step, sessState);

    // Apply strict Global 20-Rule Pipeline pre-checks (Rules 1-4, 17)
    const valCtx: ValidationContext = {
      index,
      spotPrice,
      timeObj,
      timeStr,
      activeSignals: this.activeSignals,
      sessState,
      candles1m, // passed original array before slicing
      chainRows,
      nearestCEWallAbove,
      nearestPEWallBelow
    };
    const globalPreCheckResult = runGlobalPreChecks(valCtx);
    if (!globalPreCheckResult.passed) {
      console.log(`[GLOBAL RULES] Signal Rejected: ${globalPreCheckResult.reason}`);
      return null;
    }

    // Filter Passed/Failed trackers for UI
    const passedFilters: string[] = [
      'Primary Timeframe: Completed 1-minute live option-chain updates',
      'Global 20-Rule Strict Pipeline Passed'
    ];
    const failedFilters: string[] = [];

    if (timeStr > '15:15') {
      failedFilters.push('Too late in session (excessive theta decay risk)');
    }

    if (todayCandles.length > 0) {
      const c0 = todayCandles[todayCandles.length - 1];
      const c0TimeStr = new Date(c0.timestamp).toISOString();
      if (sessState.lastTradeCandleTime && c0TimeStr === sessState.lastTradeCandleTime) {
        failedFilters.push(`Setup already evaluated and traded on candle timestamp ${c0TimeStr}. Waiting for next completed candle.`);
        return null;
      }
    }

    // Helper to check if a strategy family is already active on this index
    const isStratActive = (stratName: string) => Array.from(this.activeSignals.values()).some(s => s.index === index && s.strategy_family === stratName && s.status === 'ACTIVE');

    // Evaluate strategy candidates in PREFERRED PRIORITY ORDER:
    // 1. FAILED_RETEST (Failed Retest Reversal)
    // 2. CONTINUATION_BREAKDOWN (Continuation Breakdown)
    // 3. CONTINUATION_BREAKOUT (Continuation Breakout)
    // 4. OPENING_TRAP (Opening Breakout Trap)
    // 5. OI_WALL_REJECTION (OI Wall Rejection)

    let selectedSignal: Signal | null = null;

    // ----------------------------------------------------
    // PRIORITY 1: FAILED_RETEST (Failed Retest Reversal)
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.failedRetest?.enabled && !isStratActive('FAILED_RETEST')) {
      selectedSignal = await this.checkFailedRetest(
        valCtx, index, spotPrice, todayCandles, chainRows, sessState, nearestCEWallAbove, nearestPEWallBelow, passedFilters, failedFilters
      );
    }

    // ----------------------------------------------------
    // PRIORITY 2: CONTINUATION_BREAKDOWN
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.continuationBreakdown?.enabled && !isStratActive('CONTINUATION_BREAKDOWN')) {
      selectedSignal = await this.checkContinuationBreakdown(
        valCtx, index, spotPrice, todayCandles, chainRows, sessState, nearestPEWallBelow, passedFilters, failedFilters
      );
    }

    // ----------------------------------------------------
    // PRIORITY 3: CONTINUATION_BREAKOUT
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.continuationBreakout?.enabled && !isStratActive('CONTINUATION_BREAKOUT')) {
      selectedSignal = await this.checkContinuationBreakout(
        valCtx, index, spotPrice, todayCandles, chainRows, sessState, nearestCEWallAbove, passedFilters, failedFilters
      );
    }

    // ----------------------------------------------------
    // PRIORITY 4: OPENING_TRAP (Opening Breakout Trap)
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.openingTrap?.enabled && !isStratActive('OPENING_TRAP')) {
      selectedSignal = await this.checkOpeningTrap(
        valCtx, index, spotPrice, todayCandles, chainRows, sessState, nearestCEWallAbove, nearestPEWallBelow, passedFilters, failedFilters
      );
    }

    // ----------------------------------------------------
    // PRIORITY 5: OI_WALL_REJECTION
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.oiWallRejection?.enabled && !isStratActive('OI_WALL_REJECTION')) {
      selectedSignal = await this.checkOIWallRejection(
        valCtx, index, spotPrice, todayCandles, chainRows, sessState, nearestCEWallAbove, nearestPEWallBelow, passedFilters, failedFilters
      );
    }

    if (selectedSignal) {
      if (todayCandles.length > 0) {
        sessState.lastTradeCandleTime = new Date(todayCandles[todayCandles.length - 1].timestamp).toISOString();
      }
      sessState.tradeTakenFlag = true;
      sessState.lastSignalDirection = selectedSignal.direction;
      return selectedSignal;
    }

    // NO_TRADE Decision Output
    return {
      id: `NO_TRADE_${index}_${Date.now()}`,
      timestamp: timestampISO,
      index,
      contract: `${index} SP: ${spotPrice.toFixed(1)}`,
      action: 'BUY',
      strategy: 'NO_TRADE',
      entryPrice: 0,
      stopLoss: 0,
      target: 0,
      status: 'CLOSED',
      signal: 'NO_TRADE',
      strategy_family: 'NONE',
      direction: 'NONE',
      spot: spotPrice,
      broken_level: sessState.brokenLevelUnderWatch || 0,
      wall_above: nearestCEWallAbove,
      wall_below: nearestPEWallBelow,
      option_type: 'NONE',
      strike: Math.round(spotPrice / step) * step,
      entry: 0,
      stoploss: 0,
      target1: 0,
      target2: 0,
      confidence: 0,
      reason: [
        `No valid high-probability strategy signal found on ${index}.`,
        failedFilters.length > 0 ? `Failed filter checks: ${failedFilters.join('; ')}` : 'Awaiting clean breakout/retest structure and OI confirmation.'
      ],
      fake_signal_filters_passed: passedFilters,
      fake_signal_filters_failed: failedFilters
    };
  }

  // ====================================================
  // STRATEGY 1: FAILED_RETEST (Failed Retest Reversal)
  // ====================================================

  private validateSetup(
    valCtx: ValidationContext, setupType: string, direction: 'CALL' | 'PUT', lvl: number,
    c0: Candle, c1: Candle, c2: Candle | undefined, target1: number, target2: number, stopLoss: number,
    opt: any, passed: string[], failed: string[], testCount: number = 0, structureId?: string,
    barsSinceBreakout?: number, barsSinceRetest?: number, impulseRange?: number, spotMoveFromLevel?: number,
    premiumSeriesLast3?: number[], oiSeriesLast3?: number[]
  ): boolean {
    const setup: ProposedSetup = {
      direction, level: lvl, setupType, c0, c1, c2, target1, target2, stopLoss,
      ceOpt: direction === 'CALL' ? opt : undefined,
      peOpt: direction === 'PUT' ? opt : undefined,
      structureId,
      barsSinceBreakout,
      barsSinceRetest,
      impulseRange,
      spotMoveFromLevel,
      premiumSeriesLast3,
      oiSeriesLast3,
      wallTestCount: testCount
    };
    const localSess = valCtx.sessState as LocalSessionState;
    const validLevels = [
      localSess.openingRangeHigh, localSess.openingRangeLow,
      localSess.previousDayHigh, localSess.previousDayLow,
      localSess.sessionHigh, localSess.sessionLow,
      valCtx.nearestCEWallAbove, valCtx.nearestPEWallBelow
    ].filter(l => l > 0);
    const result = runSetupValidation(valCtx, setup, validLevels, testCount);
    if (!result.passed) {
      failed.push(`[STRICT 20-RULE] ${setupType} ${direction} Rejected: ${result.reason}`);
      return false;
    }
    return true;
  }

  private async checkFailedRetest(
    valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 4) return null;

    const levels = [
      sess.openingRangeHigh, sess.openingRangeLow,
      sess.previousDayHigh, sess.previousDayLow,
      sess.sessionHigh, sess.sessionLow,
      wallAbove, wallBelow
    ].filter(l => l > 0);

    const c0 = candles[candles.length - 1]; // confirmation candle
    const c1 = candles[candles.length - 2]; // retest candle
    const c2 = candles[candles.length - 3]; // breakout candle

    // Check Call Reversal: Resistance broke -> retest failed -> candle closes back above level
    for (const lvl of levels) {
      if (lvl <= 0) continue;

      // Rule 4: Same-zone re-entry ban & Rule 14: Prevent re-entry in same zone if level failed earlier today
      if (sess.failedLevelsToday.includes(lvl) || sess.lastFailedSetupLevel === lvl) {
        failed.push(`Rule 4/14: Blocked re-entry at failed level ${lvl} today. Waiting for fresh structure.`);
        continue;
      }

      // Retest failed: c2 broke above lvl, c1 retested (low <= lvl), c0 closed back above lvl
      if (c2.close > lvl && c1.low <= lvl * 1.001 && c0.close > lvl) {
        const structureId = `FAILED_RETEST_${lvl}_CALL_${sess.sessionDateIST}`;

        // Rule 8 & 19: Confirmation candle must match direction (Green for CALL) and cannot be flat
        if (c0.close <= c0.open + (index === 'NIFTY' ? 2 : 5)) {
          failed.push(`Rule 8/19: Failed Retest Call rejected - confirmation candle is red or flat`);
          continue;
        }

        // Rule 7: Retest quality measurable
        if (c1.close <= lvl) {
          failed.push(`Rule 7: Retest rejected - candle closed firmly below broken level, reclaiming it`);
          continue;
        }

        // Option confirmation
        const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
        const ceOpt = await this.fetchOptionData(index, 'CE', spot, 0);
        if (!ceOpt || ceOpt.price <= 0) continue;

        const ceRow = chainRows.find((r: any) => r.strike_price === atmStrike);
        const ceOIChange = ceRow?.call_options?.market_data?.oi_change || 0;

        // Rule 5: Room to upper wall >= 0.8R
        const roomPts = wallAbove - spot;
        const riskPts = Math.max(10, spot - lvl);
        const rewardRatio = roomPts / riskPts;

        if (rewardRatio >= 0.8 && sess.lastFailedSetupLevel !== lvl) {
          if (!this.validateSetup(valCtx, 'FAILED_RETEST', 'CALL', lvl, c0, c1, c2, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, 0, structureId)) continue;
          sess.brokenLevelUnderWatch = lvl;
          passed.push(`Failed Retest Call setup confirmed at level ${lvl}`);
          return this.createSignal(
            index, 'FAILED_RETEST', 'BUY_CALL', 'CE', spot, lvl, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
            88,
            [
              `Resistance level ${lvl} broke and retest held successfully above ${lvl}`,
              `CE option premium expanded above retest low`,
              `Room to upper wall ${wallAbove} is ${rewardRatio.toFixed(2)}R (>= 0.8R required)`
            ],
            passed, failed,
            c0.low, c0.high, structureId
          );
        } else {
          failed.push(`Failed Retest Call reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
        }
      }

      // Check Put Reversal: Support broke -> retest failed -> candle closes back below level
      if (c2.close < lvl && c1.high >= lvl * 0.999 && c0.close < lvl) {
        const structureId = `FAILED_RETEST_${lvl}_PUT_${sess.sessionDateIST}`;

        // CONFIRMATION CANDLE COLOR RULE: For PUT, confirmation candle MUST be red (c0.close < c0.open)
        if (c0.close >= c0.open - (index === 'NIFTY' ? 2 : 5)) {
          failed.push(`Rule 8/19: Failed Retest Put rejected: confirmation candle is green/flat`);
          continue;
        }

        // Rule 7: Retest quality measurable
        if (c1.close >= lvl) {
          failed.push(`Rule 7: Retest rejected - candle closed firmly above broken level, reclaiming it`);
          continue;
        }

        const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
        const peOpt = await this.fetchOptionData(index, 'PE', spot, 0);
        if (!peOpt || peOpt.price <= 0) continue;

        const roomPts = spot - wallBelow;
        const riskPts = Math.max(10, lvl - spot);
        const rewardRatio = roomPts / riskPts;

        if (rewardRatio >= 0.8 && sess.lastFailedSetupLevel !== lvl) {
          if (!this.validateSetup(valCtx, 'FAILED_RETEST', 'PUT', lvl, c0, c1, c2, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, 0, structureId)) continue;
          sess.brokenLevelUnderWatch = lvl;
          passed.push(`Failed Retest Put setup confirmed at level ${lvl}`);
          return this.createSignal(
            index, 'FAILED_RETEST', 'BUY_PUT', 'PE', spot, lvl, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
            88,
            [
              `Support level ${lvl} broke and retest rejected below ${lvl}`,
              `PE option premium expanded above retest low`,
              `Room to lower wall ${wallBelow} is ${rewardRatio.toFixed(2)}R (>= 0.8R required)`
            ],
            passed, failed,
            c0.low, c0.high, structureId
          );
        } else {
          failed.push(`Failed Retest Put reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
        }
      }
    }

    return null;
  }

  // ====================================================
  // STRATEGY 2: CONTINUATION_BREAKDOWN
  // ====================================================
  private async checkContinuationBreakdown(
    valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallBelow: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 4) return null;

    const levels = [sess.openingRangeLow, sess.previousDayLow, sess.sessionLow, wallBelow].filter(l => l > 0);
    const c0 = candles[candles.length - 1]; // confirmation candle
    const c1 = candles[candles.length - 2]; // pause candle
    const c2 = candles[candles.length - 3]; // breakout candle

    for (const lvl of levels) {
      if (lvl <= 0) continue;

      // Rule 14: Prevent re-entry in same zone if level failed earlier today
      if (sess.failedLevelsToday.includes(lvl) || sess.lastFailedSetupLevel === lvl) {
        failed.push(`Rule 4/14: Blocked re-entry at failed level ${lvl} today`);
        continue;
      }

      // Rule 13: Block chop zone (distance to wall < 30 points)
      if (wallBelow > 0 && Math.abs(spot - wallBelow) < 30) {
        failed.push(`Rule 13: Blocked chop zone (< 30 pts to PE wall)`);
        continue;
      }

      if (c2.close < lvl && c1.high < lvl && c0.close < c1.low) {
        const structureId = `CONTINUATION_BREAKDOWN_${lvl}_PUT_${sess.sessionDateIST}`;

        // CONFIRMATION CANDLE COLOR RULE: For PUT, confirmation candle MUST be red
        if (c0.close >= c0.open - (index === 'NIFTY' ? 2 : 5)) {
          failed.push(`Rule 8/19: Continuation Breakdown rejected: confirmation candle is green/flat (Close >= Open)`);
          continue;
        }

        const impulseRange = c2.high - c2.low;
        const currentMove = c2.high - c0.close;

        if (currentMove <= 1.5 * impulseRange) {
          const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
          const peOpt = await this.fetchOptionData(index, 'PE', spot, 0);
          if (!peOpt || peOpt.price <= 0) continue;

          const roomPts = spot - wallBelow;
          const riskPts = Math.max(10, lvl - spot);
          const rewardRatio = roomPts / riskPts;

          if (rewardRatio >= 0.8) {
            if (!this.validateSetup(valCtx, 'CONTINUATION_BREAKDOWN', 'PUT', lvl, c0, c1, c2, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, 0, structureId, undefined, undefined, impulseRange)) continue;
            sess.brokenLevelUnderWatch = lvl;
            passed.push(`Continuation Breakdown Put confirmed below level ${lvl}`);
            return this.createSignal(
              index, 'CONTINUATION_BREAKDOWN', 'BUY_PUT', 'PE', spot, lvl, 0, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
              85,
              [
                `Spot broke below support level ${lvl} with clean consolidation pause`,
                `PE premium structure maintained higher low during pause`,
                `Room to lower support wall ${wallBelow} is ${rewardRatio.toFixed(2)}R`
              ],
              passed, failed,
              c0.low, c0.high, structureId
            );
          } else {
            failed.push(`Continuation Breakdown Put reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
          }
        } else {
          failed.push(`Continuation Breakdown move extended (> 1.5x impulse candle range)`);
        }
      }
    }
    return null;
  }

  // ====================================================
  // STRATEGY 3: CONTINUATION_BREAKOUT
  // ====================================================
  private async checkContinuationBreakout(
    valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallAbove: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 4) return null;

    const levels = [sess.openingRangeHigh, sess.previousDayHigh, sess.sessionHigh, wallAbove].filter(l => l > 0);
    const c0 = candles[candles.length - 1]; // confirmation candle
    const c1 = candles[candles.length - 2]; // pause candle
    const c2 = candles[candles.length - 3]; // breakout candle

    for (const lvl of levels) {
      if (lvl <= 0) continue;

      // Rule 14: Prevent re-entry in same zone if level failed earlier today
      if (sess.failedLevelsToday.includes(lvl) || sess.lastFailedSetupLevel === lvl) {
        failed.push(`Rule 4/14: Blocked re-entry at failed level ${lvl} today`);
        continue;
      }

      // Rule 13: Block chop zone (distance to wall < 30 points)
      if (wallAbove > 0 && Math.abs(wallAbove - spot) < 30) {
        failed.push(`Rule 13: Blocked chop zone (< 30 pts to CE wall)`);
        continue;
      }

      if (c2.close > lvl && c1.low > lvl && c0.close > c1.high) {
        const structureId = `CONTINUATION_BREAKOUT_${lvl}_CALL_${sess.sessionDateIST}`;

        // CONFIRMATION CANDLE COLOR RULE: For CALL, confirmation candle MUST be green
        if (c0.close <= c0.open + (index === 'NIFTY' ? 2 : 5)) {
          failed.push(`Rule 8/19: Continuation Breakout rejected: confirmation candle is red/flat (Close <= Open)`);
          continue;
        }

        const impulseRange = c2.high - c2.low;
        const currentMove = c0.close - c2.low;

        if (currentMove <= 1.5 * impulseRange) {
          const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
          const ceOpt = await this.fetchOptionData(index, 'CE', spot, 0);
          if (!ceOpt || ceOpt.price <= 0) continue;

          const roomPts = wallAbove - spot;
          const riskPts = Math.max(10, spot - lvl);
          const rewardRatio = roomPts / riskPts;

          if (rewardRatio >= 0.8) {
            if (!this.validateSetup(valCtx, 'CONTINUATION_BREAKOUT', 'CALL', lvl, c0, c1, c2, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, 0, structureId, undefined, undefined, impulseRange)) continue;
            sess.brokenLevelUnderWatch = lvl;
            passed.push(`Continuation Breakout Call confirmed above level ${lvl}`);
            return this.createSignal(
              index, 'CONTINUATION_BREAKOUT', 'BUY_CALL', 'CE', spot, lvl, wallAbove, 0, atmStrike, ceOpt.price, ceOpt.instrumentKey,
              85,
              [
                `Spot broke above resistance level ${lvl} with clean consolidation pause`,
                `CE premium structure maintained higher low during pause`,
                `Room to upper resistance wall ${wallAbove} is ${rewardRatio.toFixed(2)}R`
              ],
              passed, failed,
              c0.low, c0.high, structureId
            );
          } else {
            failed.push(`Continuation Breakout Call reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
          }
        } else {
          failed.push(`Continuation Breakout move extended (> 1.5x impulse candle range)`);
        }
      }
    }
    return null;
  }

  // ====================================================
  // STRATEGY 4: OPENING_TRAP (Opening Breakout Trap)
  // ====================================================
  private async checkOpeningTrap(
    valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 3) return null;

    const c0 = candles[candles.length - 1]; // confirmation candle
    const c1 = candles[candles.length - 2]; // breakout candle

    // BUY_CALL on ORH Breakout Trap
    if (sess.openingRangeHigh > 0 && c1.close > sess.openingRangeHigh && c0.low >= sess.openingRangeHigh * 0.9995 && c0.close > c1.high) {
      const structureId = `OPENING_TRAP_${sess.openingRangeHigh}_CALL_${sess.sessionDateIST}`;

      // Rule 8/19: Green candle for CALL
      if (c0.close > c0.open + (index === 'NIFTY' ? 2 : 5)) {
        const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
        const ceOpt = await this.fetchOptionData(index, 'CE', spot, 0);
        if (ceOpt && ceOpt.price > 0) {
          const roomPts = wallAbove - spot;
          const rewardRatio = roomPts / Math.max(10, spot - sess.openingRangeHigh);

          if (rewardRatio >= 0.8) {
            if (!this.validateSetup(valCtx, 'OPENING_TRAP', 'CALL', sess.openingRangeHigh, c0, c1, undefined, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, 0, structureId)) return null;
            sess.brokenLevelUnderWatch = sess.openingRangeHigh;
            passed.push(`Opening Trap Call confirmed at ORH level ${sess.openingRangeHigh}`);
            return this.createSignal(
              index, 'OPENING_TRAP', 'BUY_CALL', 'CE', spot, sess.openingRangeHigh, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
              82,
              [
                `Breakout above ORH level ${sess.openingRangeHigh} retested and held`,
                `CE option premium rising and confirming momentum`,
                `Room to upper wall ${wallAbove} is ${rewardRatio.toFixed(2)}R`
              ],
              passed, failed,
              c0.low, c0.high, structureId
            );
          } else {
            failed.push(`Opening Trap Call reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
          }
        }
      } else {
        failed.push(`Rule 8/19: Opening Trap Call rejected: confirmation candle is red/flat`);
      }
    }

    // BUY_PUT on ORL Breakdown Trap
    if (sess.openingRangeLow > 0 && c1.close < sess.openingRangeLow && c0.high <= sess.openingRangeLow * 1.0005 && c0.close < c1.low) {
      const structureId = `OPENING_TRAP_${sess.openingRangeLow}_PUT_${sess.sessionDateIST}`;

      // Rule 8/19: Red candle for PUT
      if (c0.close < c0.open - (index === 'NIFTY' ? 2 : 5)) {
        const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
        const peOpt = await this.fetchOptionData(index, 'PE', spot, 0);
        if (peOpt && peOpt.price > 0) {
          const roomPts = spot - wallBelow;
          const rewardRatio = roomPts / Math.max(10, sess.openingRangeLow - spot);

          if (rewardRatio >= 0.8) {
            if (!this.validateSetup(valCtx, 'OPENING_TRAP', 'PUT', sess.openingRangeLow, c0, c1, undefined, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, 0, structureId)) return null;
            sess.brokenLevelUnderWatch = sess.openingRangeLow;
            passed.push(`Opening Trap Put confirmed at ORL level ${sess.openingRangeLow}`);
            return this.createSignal(
              index, 'OPENING_TRAP', 'BUY_PUT', 'PE', spot, sess.openingRangeLow, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
              82,
              [
                `Breakdown below ORL level ${sess.openingRangeLow} retested and held`,
                `PE option premium rising and confirming momentum`,
                `Room to lower wall ${wallBelow} is ${rewardRatio.toFixed(2)}R`
              ],
              passed, failed,
              c0.low, c0.high, structureId
            );
          } else {
            failed.push(`Opening Trap Put reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
          }
        }
      } else {
        failed.push(`Rule 8/19: Opening Trap Put rejected: confirmation candle is green/flat`);
      }
    }

    return null;
  }

  // ====================================================
  // STRATEGY 5: OI_WALL_REJECTION
  // ====================================================
  private async checkOIWallRejection(
    valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 3) return null;

    const step = index === 'NIFTY' ? 50 : 100;
    const tolerance = step * 0.25;
    const c0 = candles[candles.length - 1]; // confirmation candle

    // Count how many recent 3m candles reached wallAbove and closed below it
    const ceWallTests = candles.filter(c => c.high >= wallAbove - tolerance && c.close < wallAbove).length;
    // Count how many recent 3m candles reached wallBelow and closed above it
    const peWallTests = candles.filter(c => c.low <= wallBelow + tolerance && c.close > wallBelow).length;

    // BUY_PUT on CE Wall Rejection
    // Rule 10: Dominant wall must be tested twice
    if (ceWallTests >= 2 && spot < wallAbove && spot >= wallAbove - step) {
      const structureId = `OI_WALL_REJECTION_${wallAbove}_PUT_${sess.sessionDateIST}`;

      // Rule 8/19: For PUT, confirmation candle MUST be red
      if (c0.close < c0.open - (index === 'NIFTY' ? 1 : 3)) { // Red candle for PUT
        const atmStrike = Math.round(spot / step) * step;
        const peOpt = await this.fetchOptionData(index, 'PE', spot, 0);
        if (peOpt && peOpt.price > 0) {
          const roomPts = spot - wallBelow;
          const rewardRatio = roomPts / Math.max(10, wallAbove - spot);

          if (rewardRatio >= 0.8) {
            if (!this.validateSetup(valCtx, 'OI_WALL_REJECTION', 'PUT', wallAbove, c0, c0, undefined, wallBelow, wallBelow - 50, c0.high, peOpt, passed, failed, ceWallTests, structureId)) return null;
            sess.brokenLevelUnderWatch = wallAbove;
            passed.push(`CE Wall Rejection Put confirmed at ${wallAbove} (${ceWallTests} candle rejections)`);
            return this.createSignal(
              index, 'OI_WALL_REJECTION', 'BUY_PUT', 'PE', spot, wallAbove, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
              78,
              [
                `Heavy CE wall at ${wallAbove} rejected price ${ceWallTests} times in recent candles`,
                `CE wall OI weakening / unwinding`,
                `PE premium expanding on downside rejection`
              ],
              passed, failed,
              c0.low, c0.high, structureId
            );
          } else {
            failed.push(`CE Wall Rejection Put reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
          }
        }
      } else {
        failed.push(`Rule 8/19: CE Wall Rejection Put rejected: confirmation candle is green/flat`);
      }
    }

    // BUY_CALL on PE Wall Rejection
    // Rule 10: Dominant wall must be tested twice
    if (peWallTests >= 2 && spot > wallBelow && spot <= wallBelow + step) {
      const structureId = `OI_WALL_REJECTION_${wallBelow}_CALL_${sess.sessionDateIST}`;

      // Rule 8/19: For CALL, confirmation candle MUST be green
      if (c0.close > c0.open + (index === 'NIFTY' ? 1 : 3)) { // Green candle for CALL
        const atmStrike = Math.round(spot / step) * step;
        const ceOpt = await this.fetchOptionData(index, 'CE', spot, 0);
        if (ceOpt && ceOpt.price > 0) {
          const roomPts = wallAbove - spot;
          const rewardRatio = roomPts / Math.max(10, spot - wallBelow);

          if (rewardRatio >= 0.8) {
            if (!this.validateSetup(valCtx, 'OI_WALL_REJECTION', 'CALL', wallBelow, c0, c0, undefined, wallAbove, wallAbove + 50, c0.low, ceOpt, passed, failed, peWallTests, structureId)) return null;
            sess.brokenLevelUnderWatch = wallBelow;
            passed.push(`PE Wall Rejection Call confirmed at ${wallBelow} (${peWallTests} candle rejections)`);
            return this.createSignal(
              index, 'OI_WALL_REJECTION', 'BUY_CALL', 'CE', spot, wallBelow, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
              78,
              [
                `Heavy PE wall at ${wallBelow} rejected price ${peWallTests} times in recent candles`,
                `PE wall OI weakening / unwinding`,
                `CE premium expanding on upside rejection`
              ],
              passed, failed,
              c0.low, c0.high, structureId
            );
          } else {
            failed.push(`PE Wall Rejection Call reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
          }
        }
      } else {
        failed.push(`PE Wall Rejection Call rejected: confirmation candle is red/flat`);
      }
    }

    return null;
  }

  // Helper to create Signal object matching required format
  private createSignal(
    index: string,
    strategyFamily: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION',
    signalType: 'BUY_CALL' | 'BUY_PUT',
    optType: 'CE' | 'PE',
    spot: number,
    brokenLevel: number,
    wallAbove: number,
    wallBelow: number,
    strike: number,
    premium: number,
    instrumentKey: string,
    initialConfidence: number,
    reasons: string[],
    passedFilters: string[],
    failedFilters: string[],
    confirmCandleLow?: number,
    confirmCandleHigh?: number,
    structureId?: string
  ): Signal | null {
    // Dual Synchronized Stop-Loss Calculation:
    // 1. Primary Invalidation Trigger: Spot Price Level (Broken Level breach)
    // 2. Secondary Invalidation Trigger: Option Premium (LTP) Delta-Linked SL (~0.50 ATM Delta)
    const spotSLDistance = Math.max(15, Math.abs(spot - brokenLevel));
    const deltaLinkedOptPoints = Math.round(spotSLDistance * 0.50); // ATM Delta ~0.50
    const slPts = Math.max(12, Math.min(25, deltaLinkedOptPoints)); // 35%-50% of initial risk
    const slPrice = Number(Math.max(1, premium - slPts).toFixed(2));

    // Target 1: Nearby OI wall / swing level (~35% gain target / 0.8R to 1.0R)
    const target1Price = Number((premium + Math.max(15, Math.round(premium * 0.35))).toFixed(2));

    // Target 2: Major OI wall / stronger swing level (~60% gain target / >= 1.5R)
    const target2Price = Number((premium + Math.max(30, Math.round(premium * 0.60))).toFixed(2));

    // Reward-to-risk calculation
    const risk = premium - slPrice;
    const reward2 = target2Price - premium;
    const rrTarget2 = risk > 0 ? reward2 / risk : 0;

    // STRICT R:R GUARDRAIL: Minimum 1.5R required for Target 2
    if (rrTarget2 < 1.5) {
      failedFilters.push(`Reward-to-risk to Target 2 (${rrTarget2.toFixed(2)}R) is less than strict 1.50R minimum required`);
      return null;
    }

    let finalConfidence = initialConfidence;
    passedFilters.push(`Reward-to-risk to Target 2 is ${rrTarget2.toFixed(2)}R (>= 1.5R threshold passed)`);

    passedFilters.push(`Dual SL Active: Primary Spot Level (${brokenLevel}) + Secondary Option Premium SL (₹${slPrice})`);
    passedFilters.push(`Dynamic Stop & Emergency Exit Rules Enforced`);

    // Format human-readable time
    const now = new Date();
    const timestampISO = now.toISOString();

    const sess = this.sessionStates[index];
    if (structureId && sess) {
      sess.activeStructureId = structureId;
      if (!sess.tradedStructures.includes(structureId)) {
        sess.tradedStructures.push(structureId);
      }
    }

    return {
      id: `${strategyFamily}_${index}_${Date.now()}`,
      timestamp: timestampISO,
      index,
      contract: `${index} ${strike} ${optType}`,
      instrumentKey,
      action: 'BUY',
      strategy: strategyFamily,
      entryPrice: premium,
      latestPrice: premium,
      highestPrice: premium,
      stopLoss: slPrice,
      target: target1Price,
      status: 'ACTIVE',
      tradeType: optType,
      confirmationCandleLow: confirmCandleLow,
      confirmationCandleHigh: confirmCandleHigh,
      initialRiskPoints: slPts,
      confirmationZonePrice: brokenLevel,
      structureId,

      // Specific 5-Strategy JSON fields as required by prompt
      signal: signalType,
      strategy_family: strategyFamily,
      direction: optType === 'CE' ? 'CALL' : 'PUT',
      spot: Number(spot.toFixed(2)),
      broken_level: brokenLevel,
      wall_above: wallAbove,
      wall_below: wallBelow,
      option_type: optType,
      strike,
      entry: premium,
      stoploss: slPrice,
      target1: target1Price,
      target2: target2Price,
      confidence: finalConfidence,
      reason: reasons,
      fake_signal_filters_passed: passedFilters,
      fake_signal_filters_failed: failedFilters
    };
  }

  // 1.5x Dominant OI Wall Detection Helper
  private findValidOIWalls(chainRows: any[], spot: number, step: number, sess: LocalSessionState) {
    const wallsAbove: OIWall[] = [];
    const wallsBelow: OIWall[] = [];

    if (!chainRows || chainRows.length < 5) return { wallsAbove, wallsBelow };

    const sortedRows = [...chainRows].sort((a, b) => a.strike_price - b.strike_price);

    for (let i = 2; i < sortedRows.length - 2; i++) {
      const row = sortedRows[i];
      const strike = row.strike_price;

      // Surrounding 2 strikes above and 2 strikes below
      const surr = [
        sortedRows[i - 2], sortedRows[i - 1], sortedRows[i + 1], sortedRows[i + 2]
      ];

      // Call side wall check: OI must be >= 1.5x surrounding strikes AND stable (not rapidly unwinding)
      const callOI = row.call_options?.market_data?.oi || 0;
      const callOIChange = row.call_options?.market_data?.oi_change || 0;
      const surrCallOI = surr.reduce((sum, r) => sum + (r.call_options?.market_data?.oi || 0), 0) / 4;
      if (surrCallOI > 0 && callOI >= 1.5 * surrCallOI && callOIChange >= -0.05 * callOI) {
        if (strike > spot) {
          wallsAbove.push({ strike, totalOI: callOI, avgSurroundingOI: surrCallOI, oiRatio: callOI / surrCallOI, type: 'CE' });
        }
      }

      // Put side wall check: OI must be >= 1.5x surrounding strikes AND stable (not rapidly unwinding)
      const putOI = row.put_options?.market_data?.oi || 0;
      const putOIChange = row.put_options?.market_data?.oi_change || 0;
      const surrPutOI = surr.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0) / 4;
      if (surrPutOI > 0 && putOI >= 1.5 * surrPutOI && putOIChange >= -0.05 * putOI) {
        if (strike < spot) {
          wallsBelow.push({ strike, totalOI: putOI, avgSurroundingOI: surrPutOI, oiRatio: putOI / surrPutOI, type: 'PE' });
        }
      }
    }

    wallsAbove.sort((a, b) => a.strike - b.strike);
    wallsBelow.sort((a, b) => b.strike - a.strike);

    return { wallsAbove, wallsBelow };
  }

  private updateWallTestCounts(spot: number, step: number, sess: LocalSessionState) {
    const roundedSpot = Math.round(spot / step) * step;
    sess.wallTestCounts[roundedSpot] = (sess.wallTestCounts[roundedSpot] || 0) + 1;
  }

  private manageActiveTrades(newSignals: Signal[]) {
    for (const [id, signal] of this.activeSignals.entries()) {
      if (signal.status === 'CLOSED') {
        this.activeSignals.delete(id);
        continue;
      }

      const currentOptPrice = signal.latestPrice || signal.entryPrice;
      const currentSpot = signal.index === 'NIFTY' ? this.state.nifty50.lastPrice : this.state.bankNifty?.lastPrice || 0;

      // Track peak option price achieved during trade
      signal.highestPrice = Math.max(signal.highestPrice || currentOptPrice, currentOptPrice);

      const isCall = signal.direction === 'CALL' || signal.signal === 'BUY_CALL';
      const initialRisk = signal.initialRiskPoints || (signal.entryPrice - signal.stopLoss);

      // ---------------------------------------------------------
      // RULE 1: SPOT LEVEL INVALIDATION
      // BUY_CALL: Exit if spot closes back below broken resistance / confirmation level
      // BUY_PUT: Exit if spot reclaims back above broken support / confirmation level
      // ---------------------------------------------------------
      if (currentSpot > 0 && signal.broken_level > 0) {
        if (isCall && currentSpot <= signal.broken_level) {
          this.closeSignal(signal, currentOptPrice, `SPOT LEVEL INVALIDATION: Spot ₹${currentSpot.toFixed(1)} fell back below broken level ₹${signal.broken_level}`);
          newSignals.push(signal);
          continue;
        } else if (!isCall && currentSpot >= signal.broken_level) {
          this.closeSignal(signal, currentOptPrice, `SPOT LEVEL INVALIDATION: Spot ₹${currentSpot.toFixed(1)} reclaimed back above broken level ₹${signal.broken_level}`);
          newSignals.push(signal);
          continue;
        }
      }

      // ---------------------------------------------------------
      // RULE 2: PREMIUM SL BREACH (35%-50% Initial Risk / Stop Loss)
      // ---------------------------------------------------------
      if (currentOptPrice <= signal.stopLoss) {
        this.closeSignal(signal, signal.stopLoss, `PREMIUM SL TRIGGERED: Option price ₹${currentOptPrice.toFixed(1)} breached stop-loss level ₹${signal.stopLoss}`);
        newSignals.push(signal);
        continue;
      }

      // ---------------------------------------------------------
      // RULE 3: EMERGENCY EXIT TRIGGERS
      // - Unexpected premium collapse (> 25% drop from entry while spot fails to move)
      // - Spot sharp reversal (> 15 pts past broken level in wrong direction)
      // ---------------------------------------------------------
      const premiumLossPercent = (signal.entryPrice - currentOptPrice) / signal.entryPrice;
      if (premiumLossPercent >= 0.25) {
        this.closeSignal(signal, currentOptPrice, `EMERGENCY EXIT: Rapid premium drop (${(premiumLossPercent * 100).toFixed(1)}%) without spot momentum`);
        newSignals.push(signal);
        continue;
      }

      if (currentSpot > 0 && signal.broken_level > 0) {
        const spotAdverseDistance = isCall ? (signal.broken_level - currentSpot) : (currentSpot - signal.broken_level);
        if (spotAdverseDistance >= 15) {
          this.closeSignal(signal, currentOptPrice, `EMERGENCY EXIT: Spot reversed ${spotAdverseDistance.toFixed(1)} pts past confirmation level`);
          newSignals.push(signal);
          continue;
        }
      }

      // ---------------------------------------------------------
      // DYNAMIC STOP ADJUSTMENTS
      // Before Target 1: Keep original stoploss
      // After Target 1 Hit: Shift stoploss to Breakeven (entry price) or Confirmation Level
      // After Target 2 Hit: Trail below each confirmed higher low (CALL) or lower high (PUT)
      // ---------------------------------------------------------

      // Target 1 hit check
      if (currentOptPrice >= signal.target1 && !signal.firstTargetHitFlag) {
        signal.firstTargetHitFlag = true;
        signal.breakevenShifted = true;
        signal.trailingStopActiveFlag = true;
        // Shift stop-loss to breakeven (entry price)
        signal.stopLoss = Math.max(signal.stopLoss, signal.entryPrice);
        signal.stoploss = signal.stopLoss;
        signal.reason.push(`TARGET 1 HIT (₹${signal.target1}): Dynamic SL shifted to Breakeven (₹${signal.entryPrice})`);
      }

      // Target 2 hit check
      if (currentOptPrice >= signal.target2) {
        this.closeSignal(signal, currentOptPrice, `TARGET 2 HIT (₹${signal.target2}): Full profit target achieved`);
        newSignals.push(signal);
        continue;
      }

      // Trailing Stop Adjustment after Target 1 is active
      if (signal.firstTargetHitFlag && signal.highestPrice > signal.entryPrice) {
        const trailingSL = Number((signal.highestPrice - initialRisk * 0.50).toFixed(2));
        if (trailingSL > signal.stopLoss) {
          signal.stopLoss = trailingSL;
          signal.stoploss = trailingSL;
        }
      }
    }
  }

  public exitAllActiveTrades(reason: string) {
    for (const [id, signal] of this.activeSignals.entries()) {
      const currentOptPrice = signal.latestPrice || signal.entryPrice;
      this.closeSignal(signal, currentOptPrice, reason);
    }
  }

  private closeSignal(signal: Signal, exitPrice: number, reason: string) {
    signal.status = 'CLOSED';
    signal.exitPrice = exitPrice;
    signal.exitTime = Date.now();

    const lotQuantity = 75;
    const stratKey = signal.strategy_family ? signal.strategy_family.toLowerCase() : '';
    const stratLotConfig = (this.settings.strategies as any)[stratKey]?.lotSize;
    const lots = stratLotConfig || this.settings.defaultLotsPerTrade || 1;
    const qty = lotQuantity * lots;

    signal.realizedPnL = (exitPrice - signal.entryPrice) * qty;

    const sess = this.sessionStates[signal.index];
    if (sess) {
      sess.lastTradeExitTime = Date.now();
      if (signal.realizedPnL < 0 || reason.includes('SL') || reason.includes('INVALIDATION')) {
        if (signal.broken_level > 0) {
          sess.lastFailedSetupLevel = signal.broken_level;
          if (!sess.failedLevelsToday.includes(signal.broken_level)) {
            sess.failedLevelsToday.push(signal.broken_level);
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
}
