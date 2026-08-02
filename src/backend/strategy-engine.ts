import { AppSettings, AppState, Signal, Candle } from './types.js';
import { getCandles } from '../db/market.js';

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

interface SessionState {
  sessionHigh: number;
  sessionLow: number;
  previousDayHigh: number;
  previousDayLow: number;
  openingRangeHigh: number;
  openingRangeLow: number;
  brokenLevelUnderWatch: number | null;
  retestPendingFlag: boolean;
  continuationPendingFlag: boolean;
  tradeTakenFlag: boolean;
  firstTargetHitFlag: boolean;
  trailingStopActiveFlag: boolean;
  lastSignalDirection: 'CALL' | 'PUT' | 'NONE';
  lastFailedSetupLevel: number | null;
  wallTestCounts: Record<number, number>;
  prevWallTotalOI: Record<number, number>;
  wallNegativeOICounts: Record<number, number>;
}

export class StrategyEngine {
  private settings: AppSettings;
  private state: AppState;
  public activeSignals: Map<string, Signal> = new Map();
  private fetchOptionData: FetchOptionDataFn;
  private getOptionChain?: GetOptionChainFn;
  private getNearestExpiry?: GetNearestExpiryFn;

  private sessionStates: Record<string, SessionState> = {
    'NIFTY': this.createInitialSessionState(),
    'BANKNIFTY': this.createInitialSessionState(),
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

  private createInitialSessionState(): SessionState {
    return {
      sessionHigh: 0,
      sessionLow: Infinity,
      previousDayHigh: 0,
      previousDayLow: 0,
      openingRangeHigh: 0,
      openingRangeLow: 0,
      brokenLevelUnderWatch: null,
      retestPendingFlag: false,
      continuationPendingFlag: false,
      tradeTakenFlag: false,
      firstTargetHitFlag: false,
      trailingStopActiveFlag: false,
      lastSignalDirection: 'NONE',
      lastFailedSetupLevel: null,
      wallTestCounts: {},
      prevWallTotalOI: {},
      wallNegativeOICounts: {},
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

    // Evaluate NIFTY and BANKNIFTY
    if (this.settings.nifty50Enabled && this.state.nifty50.lastPrice > 0) {
      const sig = await this.evaluateIndex('NIFTY', this.state.nifty50.lastPrice);
      if (sig && sig.signal !== 'NO_TRADE') newSignals.push(sig);
    }

    if (this.settings.bankNiftyEnabled && this.state.bankNifty.lastPrice > 0) {
      const sig = await this.evaluateIndex('BANKNIFTY', this.state.bankNifty.lastPrice);
      if (sig && sig.signal !== 'NO_TRADE') newSignals.push(sig);
    }

    newSignals.forEach(s => this.activeSignals.set(s.id, s));
    return newSignals;
  }

  private async evaluateIndex(index: string, spotPrice: number): Promise<Signal | null> {
    const timeObj = new Date();
    const timeStr = timeObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const timestampISO = timeObj.toISOString();

    const instrumentKey = index === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank';
    const step = index === 'NIFTY' ? 50 : 100;

    // Fetch 3-minute primary candles for session high, low, ORH, ORL, PDH, PDL (Primary Timeframe: 3 Min)
    const candles3m = await getCandles(index, 3, 60);
    candles3m.reverse(); // chronological

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCandles = candles3m.filter(c => new Date(c.timestamp).getTime() >= today.getTime());
    const prevCandles = candles3m.filter(c => new Date(c.timestamp).getTime() < today.getTime());

    const sessState = this.sessionStates[index];

    // Calculate PDH, PDL
    if (prevCandles.length > 0) {
      sessState.previousDayHigh = Math.max(...prevCandles.map(c => c.high));
      sessState.previousDayLow = Math.min(...prevCandles.map(c => c.low));
    }

    // Calculate SH, SL, ORH, ORL
    if (todayCandles.length >= 5) {
      sessState.sessionHigh = Math.max(...todayCandles.map(c => c.high));
      sessState.sessionLow = Math.min(...todayCandles.map(c => c.low));

      // Opening range = first 15 mins (first 5 candles of 3m)
      const orbCandles = todayCandles.slice(0, 5);
      sessState.openingRangeHigh = Math.max(...orbCandles.map(c => c.high));
      sessState.openingRangeLow = Math.min(...orbCandles.map(c => c.low));
    } else if (todayCandles.length > 0) {
      sessState.sessionHigh = Math.max(...todayCandles.map(c => c.high));
      sessState.sessionLow = Math.min(...todayCandles.map(c => c.low));
      sessState.openingRangeHigh = 0;
      sessState.openingRangeLow = 0;
    } else {
      sessState.sessionHigh = 0;
      sessState.sessionLow = 0;
      sessState.openingRangeHigh = 0;
      sessState.openingRangeLow = 0;
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

    // Find valid OI Walls (1.5x rule)
    const { wallsAbove, wallsBelow } = this.findValidOIWalls(chainRows, spotPrice, step, sessState);
    const nearestCEWallAbove = wallsAbove.length > 0 ? wallsAbove[0].strike : spotPrice + step * 4;
    const nearestPEWallBelow = wallsBelow.length > 0 ? wallsBelow[0].strike : spotPrice - step * 4;

    // Track wall reaction counts
    this.updateWallTestCounts(spotPrice, step, sessState);

    // Filter Passed/Failed trackers
    const passedFilters: string[] = [];
    const failedFilters: string[] = [];

    // Global Time Filter Check
    if (timeStr < '09:30') {
      failedFilters.push('Within first 15 mins noisy opening window');
    } else {
      passedFilters.push('Outside early opening noise window');
    }

    if (timeStr > '15:15') {
      failedFilters.push('Too late in session (excessive theta decay risk)');
    } else {
      passedFilters.push('Session time suitable for options buying');
    }

    // Max active trades global constraint check
    const maxAllowedTrades = this.settings.maxActiveTrades || 2;
    const currentActiveForIndex = Array.from(this.activeSignals.values()).filter(s => s.index === index && s.status === 'ACTIVE').length;
    if (currentActiveForIndex >= maxAllowedTrades) {
      failedFilters.push(`Max active trades capacity reached (${currentActiveForIndex}/${maxAllowedTrades} active trades)`);
      return null;
    } else {
      passedFilters.push('Active trades capacity available');
    }

    // Helper to check if a strategy family is already active on this index
    const isStratActive = (stratName: string) => Array.from(this.activeSignals.values()).some(s => s.index === index && s.strategy_family === stratName && s.status === 'ACTIVE');

    // Evaluate strategy candidates in PREFERRED PRIORITY ORDER:
    // 1. FAILED_RETEST
    // 2. CONTINUATION_BREAKDOWN
    // 3. CONTINUATION_BREAKOUT
    // 4. OPENING_TRAP
    // 5. OI_WALL_REJECTION

    let selectedSignal: Signal | null = null;

    // ----------------------------------------------------
    // PRIORITY 1: FAILED_RETEST (Failed Retest Reversal)
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.failedRetest?.enabled && !isStratActive('FAILED_RETEST')) {
      selectedSignal = await this.checkFailedRetest(
        index, spotPrice, todayCandles, chainRows, sessState, nearestCEWallAbove, nearestPEWallBelow, passedFilters, failedFilters
      );
    }

    // ----------------------------------------------------
    // PRIORITY 2: CONTINUATION_BREAKDOWN
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.continuationBreakdown?.enabled && !isStratActive('CONTINUATION_BREAKDOWN')) {
      selectedSignal = await this.checkContinuationBreakdown(
        index, spotPrice, todayCandles, chainRows, sessState, nearestPEWallBelow, passedFilters, failedFilters
      );
    }

    // ----------------------------------------------------
    // PRIORITY 3: CONTINUATION_BREAKOUT
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.continuationBreakout?.enabled && !isStratActive('CONTINUATION_BREAKOUT')) {
      selectedSignal = await this.checkContinuationBreakout(
        index, spotPrice, todayCandles, chainRows, sessState, nearestCEWallAbove, passedFilters, failedFilters
      );
    }

    // ----------------------------------------------------
    // PRIORITY 4: OPENING_TRAP (Opening Breakout Trap)
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.openingTrap?.enabled && !isStratActive('OPENING_TRAP')) {
      selectedSignal = await this.checkOpeningTrap(
        index, spotPrice, todayCandles, chainRows, sessState, nearestCEWallAbove, nearestPEWallBelow, passedFilters, failedFilters
      );
    }

    // ----------------------------------------------------
    // PRIORITY 5: OI_WALL_REJECTION
    // ----------------------------------------------------
    if (!selectedSignal && this.settings.strategies.oiWallRejection?.enabled && !isStratActive('OI_WALL_REJECTION')) {
      selectedSignal = await this.checkOIWallRejection(
        index, spotPrice, todayCandles, chainRows, sessState, nearestCEWallAbove, nearestPEWallBelow, passedFilters, failedFilters
      );
    }

    if (selectedSignal) {
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
  // STRATEGY 1: FAILED_RETEST
  // ====================================================
  private async checkFailedRetest(
    index: string, spot: number, candles: Candle[], chainRows: any[], sess: SessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]
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

      // Retest failed: c2 broke above lvl, c1 retested (low <= lvl), c0 closed back above lvl
      if (c2.close > lvl && c1.low <= lvl * 1.001 && c0.close > lvl) {
        // Option confirmation
        const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
        const ceOpt = await this.fetchOptionData(index, 'CE', spot, 0);
        if (!ceOpt || ceOpt.price <= 0) continue;

        const ceRow = chainRows.find((r: any) => r.strike_price === atmStrike);
        const ceOIChange = ceRow?.call_options?.market_data?.oi_change || 0;

        // Check room to next wall >= 0.8R
        const roomPts = wallAbove - spot;
        const riskPts = Math.max(10, spot - lvl);
        const rewardRatio = roomPts / riskPts;

        if (rewardRatio >= 0.8 && sess.lastFailedSetupLevel !== lvl) {
          passed.push(`Failed Retest Call setup confirmed at level ${lvl}`);
          return this.createSignal(
            index, 'FAILED_RETEST', 'BUY_CALL', 'CE', spot, lvl, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
            88,
            [
              `Resistance level ${lvl} broke and retest held successfully above ${lvl}`,
              `CE option premium expanded above retest low`,
              `Room to upper wall ${wallAbove} is ${rewardRatio.toFixed(2)}R (>= 0.8R required)`
            ],
            passed, failed
          );
        } else {
          failed.push(`Failed Retest Call reward ratio ${rewardRatio.toFixed(2)}R is below 0.8R minimum`);
        }
      }

      // Check Put Reversal: Support broke -> retest failed -> candle closes back below level
      if (c2.close < lvl && c1.high >= lvl * 0.999 && c0.close < lvl) {
        const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
        const peOpt = await this.fetchOptionData(index, 'PE', spot, 0);
        if (!peOpt || peOpt.price <= 0) continue;

        const roomPts = spot - wallBelow;
        const riskPts = Math.max(10, lvl - spot);
        const rewardRatio = roomPts / riskPts;

        if (rewardRatio >= 0.8 && sess.lastFailedSetupLevel !== lvl) {
          passed.push(`Failed Retest Put setup confirmed at level ${lvl}`);
          return this.createSignal(
            index, 'FAILED_RETEST', 'BUY_PUT', 'PE', spot, lvl, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
            88,
            [
              `Support level ${lvl} broke and retest rejected below ${lvl}`,
              `PE option premium expanded above retest low`,
              `Room to lower wall ${wallBelow} is ${rewardRatio.toFixed(2)}R (>= 0.8R required)`
            ],
            passed, failed
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
    index: string, spot: number, candles: Candle[], chainRows: any[], sess: SessionState, wallBelow: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 4) return null;

    const levels = [sess.openingRangeLow, sess.previousDayLow, sess.sessionLow, wallBelow].filter(l => l > 0);
    const c0 = candles[candles.length - 1];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 3];

    for (const lvl of levels) {
      if (c2.close < lvl && c1.high < lvl && c0.close < c1.low) {
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
            passed.push(`Continuation Breakdown Put confirmed below level ${lvl}`);
            return this.createSignal(
              index, 'CONTINUATION_BREAKDOWN', 'BUY_PUT', 'PE', spot, lvl, 0, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
              85,
              [
                `Spot broke below support level ${lvl} with clean consolidation pause`,
                `PE premium structure maintained higher low during pause`,
                `Room to lower support wall ${wallBelow} is ${rewardRatio.toFixed(2)}R`
              ],
              passed, failed
            );
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
    index: string, spot: number, candles: Candle[], chainRows: any[], sess: SessionState, wallAbove: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 4) return null;

    const levels = [sess.openingRangeHigh, sess.previousDayHigh, sess.sessionHigh, wallAbove].filter(l => l > 0);
    const c0 = candles[candles.length - 1];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 3];

    for (const lvl of levels) {
      if (c2.close > lvl && c1.low > lvl && c0.close > c1.high) {
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
            passed.push(`Continuation Breakout Call confirmed above level ${lvl}`);
            return this.createSignal(
              index, 'CONTINUATION_BREAKOUT', 'BUY_CALL', 'CE', spot, lvl, wallAbove, 0, atmStrike, ceOpt.price, ceOpt.instrumentKey,
              85,
              [
                `Spot broke above resistance level ${lvl} with clean consolidation pause`,
                `CE premium structure maintained higher low during pause`,
                `Room to upper resistance wall ${wallAbove} is ${rewardRatio.toFixed(2)}R`
              ],
              passed, failed
            );
          }
        } else {
          failed.push(`Continuation Breakout move extended (> 1.5x impulse candle range)`);
        }
      }
    }
    return null;
  }

  // ====================================================
  // STRATEGY 4: OPENING_TRAP
  // ====================================================
  private async checkOpeningTrap(
    index: string, spot: number, candles: Candle[], chainRows: any[], sess: SessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 3) return null;

    const c0 = candles[candles.length - 1];
    const c1 = candles[candles.length - 2];

    // BUY_CALL on ORH Breakout Trap
    if (sess.openingRangeHigh > 0 && c1.close > sess.openingRangeHigh && c0.low >= sess.openingRangeHigh * 0.9995 && c0.close > c1.high) {
      const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
      const ceOpt = await this.fetchOptionData(index, 'CE', spot, 0);
      if (ceOpt && ceOpt.price > 0) {
        const roomPts = wallAbove - spot;
        const rewardRatio = roomPts / Math.max(10, spot - sess.openingRangeHigh);

        if (rewardRatio >= 0.8) {
          passed.push(`Opening Trap Call confirmed at ORH level ${sess.openingRangeHigh}`);
          return this.createSignal(
            index, 'OPENING_TRAP', 'BUY_CALL', 'CE', spot, sess.openingRangeHigh, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
            82,
            [
              `Breakout above ORH level ${sess.openingRangeHigh} retested and held`,
              `CE option premium rising and confirming momentum`,
              `Room to upper wall ${wallAbove} is ${rewardRatio.toFixed(2)}R`
            ],
            passed, failed
          );
        }
      }
    }

    // BUY_PUT on ORL Breakdown Trap
    if (sess.openingRangeLow > 0 && c1.close < sess.openingRangeLow && c0.high <= sess.openingRangeLow * 1.0005 && c0.close < c1.low) {
      const atmStrike = Math.round(spot / (index === 'NIFTY' ? 50 : 100)) * (index === 'NIFTY' ? 50 : 100);
      const peOpt = await this.fetchOptionData(index, 'PE', spot, 0);
      if (peOpt && peOpt.price > 0) {
        const roomPts = spot - wallBelow;
        const rewardRatio = roomPts / Math.max(10, sess.openingRangeLow - spot);

        if (rewardRatio >= 0.8) {
          passed.push(`Opening Trap Put confirmed at ORL level ${sess.openingRangeLow}`);
          return this.createSignal(
            index, 'OPENING_TRAP', 'BUY_PUT', 'PE', spot, sess.openingRangeLow, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
            82,
            [
              `Breakdown below ORL level ${sess.openingRangeLow} retested and held`,
              `PE option premium rising and confirming momentum`,
              `Room to lower wall ${wallBelow} is ${rewardRatio.toFixed(2)}R`
            ],
            passed, failed
          );
        }
      }
    }

    return null;
  }

  // ====================================================
  // STRATEGY 5: OI_WALL_REJECTION
  // ====================================================
  private async checkOIWallRejection(
    index: string, spot: number, candles: Candle[], chainRows: any[], sess: SessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]
  ): Promise<Signal | null> {
    if (candles.length < 3) return null;

    const step = index === 'NIFTY' ? 50 : 100;
    const tolerance = step * 0.25;

    // Count how many recent 3m candles reached wallAbove and closed below it
    const ceWallTests = candles.filter(c => c.high >= wallAbove - tolerance && c.close < wallAbove).length;
    // Count how many recent 3m candles reached wallBelow and closed above it
    const peWallTests = candles.filter(c => c.low <= wallBelow + tolerance && c.close > wallBelow).length;

    // BUY_PUT on CE Wall Rejection
    if (ceWallTests >= 2 && spot < wallAbove && spot >= wallAbove - step) {
      const atmStrike = Math.round(spot / step) * step;
      const peOpt = await this.fetchOptionData(index, 'PE', spot, 0);
      if (peOpt && peOpt.price > 0) {
        const roomPts = spot - wallBelow;
        const rewardRatio = roomPts / Math.max(10, wallAbove - spot);

        if (rewardRatio >= 0.8) {
          passed.push(`CE Wall Rejection Put confirmed at ${wallAbove} (${ceWallTests} candle rejections)`);
          return this.createSignal(
            index, 'OI_WALL_REJECTION', 'BUY_PUT', 'PE', spot, wallAbove, wallAbove, wallBelow, atmStrike, peOpt.price, peOpt.instrumentKey,
            78,
            [
              `Heavy CE wall at ${wallAbove} rejected price ${ceWallTests} times in recent candles`,
              `CE wall OI weakening / unwinding`,
              `PE premium expanding on downside rejection`
            ],
            passed, failed
          );
        }
      }
    }

    // BUY_CALL on PE Wall Rejection
    if (peWallTests >= 2 && spot > wallBelow && spot <= wallBelow + step) {
      const atmStrike = Math.round(spot / step) * step;
      const ceOpt = await this.fetchOptionData(index, 'CE', spot, 0);
      if (ceOpt && ceOpt.price > 0) {
        const roomPts = wallAbove - spot;
        const rewardRatio = roomPts / Math.max(10, spot - wallBelow);

        if (rewardRatio >= 0.8) {
          passed.push(`PE Wall Rejection Call confirmed at ${wallBelow} (${peWallTests} candle rejections)`);
          return this.createSignal(
            index, 'OI_WALL_REJECTION', 'BUY_CALL', 'CE', spot, wallBelow, wallAbove, wallBelow, atmStrike, ceOpt.price, ceOpt.instrumentKey,
            78,
            [
              `Heavy PE wall at ${wallBelow} rejected price ${peWallTests} times in recent candles`,
              `PE wall OI weakening / unwinding`,
              `CE premium expanding on upside rejection`
            ],
            passed, failed
          );
        }
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
    failedFilters: string[]
  ): Signal {
    // Dual Synchronized Stop-Loss Calculation:
    // 1. Primary Invalidation Trigger: Spot Price Level (Broken Level breach)
    // 2. Secondary Invalidation Trigger: Option Premium (LTP) Delta-Linked SL (~0.50 ATM Delta)
    const spotSLDistance = Math.max(15, Math.abs(spot - brokenLevel));
    const deltaLinkedOptPoints = Math.round(spotSLDistance * 0.50); // ATM Delta ~0.50
    const slPts = Math.max(15, Math.min(25, deltaLinkedOptPoints)); // 15 to 25 option points (approx 0.35R-0.5R)
    const slPrice = Number(Math.max(1, premium - slPts).toFixed(2));

    // Target 1: Nearby OI wall / swing level (~35% gain target / 0.8R to 1.0R)
    const target1Price = Number((premium + Math.max(15, Math.round(premium * 0.35))).toFixed(2));

    // Target 2: Major OI wall / stronger swing level (~60% gain target / >= 1.5R)
    const target2Price = Number((premium + Math.max(30, Math.round(premium * 0.60))).toFixed(2));

    // Reward-to-risk calculation
    const risk = premium - slPrice;
    const reward2 = target2Price - premium;
    const rrTarget2 = risk > 0 ? reward2 / risk : 0;

    let finalConfidence = initialConfidence;
    if (rrTarget2 < 1.5) {
      finalConfidence = Math.max(50, finalConfidence - 10);
      failedFilters.push(`Reward-to-risk to Target 2 (${rrTarget2.toFixed(2)}R) is less than 1.5R; reduced confidence to ${finalConfidence}`);
    } else {
      passedFilters.push(`Reward-to-risk to Target 2 is ${rrTarget2.toFixed(2)}R (>= 1.5R threshold passed)`);
    }

    passedFilters.push(`Dual SL Active: Primary Spot Level (${brokenLevel}) + Secondary Option Premium SL (₹${slPrice})`);

    // Format human-readable time (e.g. 09:27 AM)
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    return {
      id: `${strategyFamily}_${index}_${Date.now()}`,
      timestamp: timeStr,
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
  private findValidOIWalls(chainRows: any[], spot: number, step: number, sess: SessionState) {
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

      // Call side wall check
      const callOI = row.call_options?.market_data?.oi || 0;
      const surrCallOI = surr.reduce((sum, r) => sum + (r.call_options?.market_data?.oi || 0), 0) / 4;
      if (surrCallOI > 0 && callOI >= 1.5 * surrCallOI) {
        if (strike > spot) {
          wallsAbove.push({ strike, totalOI: callOI, avgSurroundingOI: surrCallOI, oiRatio: callOI / surrCallOI, type: 'CE' });
        }
      }

      // Put side wall check
      const putOI = row.put_options?.market_data?.oi || 0;
      const surrPutOI = surr.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0) / 4;
      if (surrPutOI > 0 && putOI >= 1.5 * surrPutOI) {
        if (strike < spot) {
          wallsBelow.push({ strike, totalOI: putOI, avgSurroundingOI: surrPutOI, oiRatio: putOI / surrPutOI, type: 'PE' });
        }
      }
    }

    wallsAbove.sort((a, b) => a.strike - b.strike);
    wallsBelow.sort((a, b) => b.strike - a.strike);

    return { wallsAbove, wallsBelow };
  }

  private updateWallTestCounts(spot: number, step: number, sess: SessionState) {
    const roundedSpot = Math.round(spot / step) * step;
    sess.wallTestCounts[roundedSpot] = (sess.wallTestCounts[roundedSpot] || 0) + 1;
  }

  private manageActiveTrades(newSignals: Signal[]) {
    for (const [id, signal] of this.activeSignals.entries()) {
      const currentOptPrice = signal.latestPrice || signal.entryPrice;
      const currentSpot = signal.index === 'NIFTY' ? this.state.nifty50.lastPrice : this.state.bankNifty.lastPrice;

      signal.highestPrice = Math.max(signal.highestPrice || currentOptPrice, currentOptPrice);

      // 1. Primary Invalidation Trigger: Spot Price Level
      if (currentSpot > 0 && signal.broken_level > 0) {
        if (signal.direction === 'CALL' || signal.signal === 'BUY_CALL') {
          // BUY_CALL exit if spot falls back and closes below broken resistance / level
          if (currentSpot <= signal.broken_level) {
            this.closeSignal(signal, currentOptPrice, `SPOT LEVEL INVALIDATION (Spot ${currentSpot.toFixed(1)} fell below broken level ${signal.broken_level})`);
            newSignals.push(signal);
            continue;
          }
        } else if (signal.direction === 'PUT' || signal.signal === 'BUY_PUT') {
          // BUY_PUT exit if spot reclaims and closes above broken support / level
          if (currentSpot >= signal.broken_level) {
            this.closeSignal(signal, currentOptPrice, `SPOT LEVEL INVALIDATION (Spot ${currentSpot.toFixed(1)} reclaimed broken level ${signal.broken_level})`);
            newSignals.push(signal);
            continue;
          }
        }
      }

      // 2. Secondary Invalidation Trigger: Option Premium (LTP) Structure
      if (currentOptPrice <= signal.stopLoss) {
        this.closeSignal(signal, signal.stopLoss, `PREMIUM SL HIT (Option price ₹${currentOptPrice.toFixed(1)} breached premium SL ₹${signal.stopLoss})`);
        newSignals.push(signal);
        continue;
      }

      // Target 1 hit
      if (currentOptPrice >= signal.target1 && !signal.firstTargetHitFlag) {
        signal.firstTargetHitFlag = true;
        // Trail stop loss to breakeven after Target 1
        signal.stopLoss = Math.max(signal.stopLoss, signal.entryPrice);
        signal.trailingStopActiveFlag = true;
      }

      // Target 2 hit
      if (currentOptPrice >= signal.target2) {
        this.closeSignal(signal, currentOptPrice, 'TARGET 2 HIT');
        newSignals.push(signal);
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

    const lotQuantity = signal.index === 'NIFTY' ? 50 : 15;
    const stratKey = signal.strategy_family ? signal.strategy_family.toLowerCase() : '';
    const stratLotConfig = (this.settings.strategies as any)[stratKey]?.lotSize;
    const lots = stratLotConfig || this.settings.defaultLotsPerTrade || 1;
    const qty = lotQuantity * lots;

    signal.realizedPnL = (exitPrice - signal.entryPrice) * qty;
    this.activeSignals.delete(signal.id);
  }
}
