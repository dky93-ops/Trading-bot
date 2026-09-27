/**
 * NIFTY MACD + Adaptive SuperTrend Strategy
 * Version 1.0
 * 
 * This strategy combines:
 * 1. MACD (Moving Average Convergence Divergence) for trend confirmation
 * 2. Adaptive SuperTrend for dynamic support/resistance and trend reversal signals
 * 3. Risk management with adaptive position sizing
 */

export class UniversalEventEmitter {
  private _listeners: Record<string, Array<(...args: any[]) => void>> = {};

  on(event: string, fn: (...args: any[]) => void): this {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  }

  addListener(event: string, fn: (...args: any[]) => void): this {
    return this.on(event, fn);
  }

  off(event: string, fn: (...args: any[]) => void): this {
    if (!this._listeners[event]) return this;
    this._listeners[event] = this._listeners[event].filter(listener => listener !== fn);
    return this;
  }

  removeListener(event: string, fn: (...args: any[]) => void): this {
    return this.off(event, fn);
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this._listeners[event];
    if (!listeners || listeners.length === 0) return false;
    listeners.forEach(fn => {
      try { fn(...args); } catch (e) { console.error('EventEmitter listener error:', e); }
    });
    return true;
  }

  removeAllListeners(event?: string): this {
    if (event) delete this._listeners[event];
    else this._listeners = {};
    return this;
  }
}

export type EventEmitter = UniversalEventEmitter;

export interface StrategyConfigOptions {
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  atrPeriod?: number;
  superTrendMultiplier?: number;
  riskPerTrade?: number;
  maxDailyLoss?: number;
  profitTarget?: number;
  minVolume?: number;
  tradingHours?: { start: string; end: string };
  enableAdaptiveMultiplier?: boolean;
  lookbackPeriod?: number;
}

export interface CandleInput {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timestamp?: string | number;
}

export interface TradeRecord {
  type: string | null;
  entryPrice: number | null;
  exitPrice: number;
  entryTime: string | null;
  exitTime: string;
  size: number | null;
  pnl: number;
  reason: string;
}

export interface SignalDetails {
  entryPrice?: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  positionSize?: number;
  reason?: string;
  superTrendLevel?: number;
  macdHistogram?: number;
  pnl?: number;
}

export interface SignalResult extends SignalDetails {
  signal: 'BUY' | 'SELL' | 'EXIT_BUY' | 'EXIT_SELL' | 'NONE';
  reason: string;
}

export class NiftyMacdAdaptiveSupertrend extends UniversalEventEmitter {
  public config: {
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    atrPeriod: number;
    superTrendMultiplier: number;
    riskPerTrade: number;
    maxDailyLoss: number;
    profitTarget: number;
    minVolume: number;
    tradingHours: { start: string; end: string };
    enableAdaptiveMultiplier: boolean;
    lookbackPeriod: number;
  };

  public state: {
    isInPosition: boolean;
    entryPrice: number | null;
    entryTime: string | null;
    positionSize: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    currentTrend: 'uptrend' | 'downtrend' | 'BUY' | 'SELL' | null;
    dailyPnL: number;
    trades: TradeRecord[];
    canTrade: boolean;
  };

  public priceData: {
    close: number[];
    high: number[];
    low: number[];
    volume: number[];
    open: number[];
  };

  constructor(config: StrategyConfigOptions = {}) {
    super();

    // Strategy Configuration
    this.config = {
      // MACD Parameters
      macdFast: config.macdFast || 12,
      macdSlow: config.macdSlow || 26,
      macdSignal: config.macdSignal || 9,

      // SuperTrend Parameters
      atrPeriod: config.atrPeriod || 10,
      superTrendMultiplier: config.superTrendMultiplier || 3,

      // Risk Management
      riskPerTrade: config.riskPerTrade || 0.02, // 2% per trade
      maxDailyLoss: config.maxDailyLoss || 0.05, // 5% max daily loss
      profitTarget: config.profitTarget || 0.03, // 3% profit target

      // Trading Parameters
      minVolume: config.minVolume || 100000,
      tradingHours: config.tradingHours || { start: '09:15', end: '15:30' },
      enableAdaptiveMultiplier: config.enableAdaptiveMultiplier !== false,

      // Lookback periods
      lookbackPeriod: config.lookbackPeriod || 100,
    };

    // State Variables
    this.state = {
      isInPosition: false,
      entryPrice: null,
      entryTime: null,
      positionSize: null,
      stopLoss: null,
      takeProfit: null,
      currentTrend: null, // 'uptrend' or 'downtrend'
      dailyPnL: 0,
      trades: [],
      canTrade: true,
    };

    // Price data cache
    this.priceData = {
      close: [],
      high: [],
      low: [],
      volume: [],
      open: [],
    };
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  calculateMACD(closes: number[]) {
    if (closes.length < this.config.macdSlow + this.config.macdSignal) {
      return null;
    }

    const ema12 = this.calculateEMA(closes, this.config.macdFast);
    const ema26 = this.calculateEMA(closes, this.config.macdSlow);
    if (!ema12 || !ema26) return null;

    const macdLine = ema12.map((val, idx) => val - ema26[idx]);
    const signalLine = this.calculateEMA(macdLine, this.config.macdSignal);
    if (!signalLine) return null;
    const histogram = macdLine.map((val, idx) => val - signalLine[idx]);

    return {
      macdLine: macdLine[macdLine.length - 1],
      signalLine: signalLine[signalLine.length - 1],
      histogram: histogram[histogram.length - 1],
      macdPrev: macdLine[macdLine.length - 2],
      signalPrev: signalLine[signalLine.length - 2],
    };
  }

  /**
   * Calculate Adaptive SuperTrend
   */
  calculateAdaptiveSupertrend(high: number[], low: number[], close: number[], volume: number[]) {
    if (high.length < this.config.atrPeriod * 2) {
      return null;
    }

    // Calculate ATR (Average True Range)
    const atr = this.calculateATR(high, low, close);
    if (!atr || atr.length === 0) return null;

    // Calculate basic SuperTrend
    const hl2 = high.map((h, i) => (h + low[i]) / 2);
    const currentHL2 = hl2[hl2.length - 1];

    // Adaptive multiplier based on volatility
    let multiplier = this.config.superTrendMultiplier;

    if (this.config.enableAdaptiveMultiplier) {
      const volatility = this.calculateVolatility(close);
      multiplier = this.config.superTrendMultiplier * (1 + volatility / 100);
    }

    const basicUB = currentHL2 + multiplier * atr[atr.length - 1];
    const basicLB = currentHL2 - multiplier * atr[atr.length - 1];

    // Final SuperTrend calculation
    const currentClose = close[close.length - 1];
    const previousClose = close[close.length - 2];

    let finalUB = basicUB;
    let finalLB = basicLB;

    if (basicLB > finalLB || previousClose < finalLB) {
      finalLB = basicLB;
    }
    if (basicUB < finalUB || previousClose > finalUB) {
      finalUB = basicUB;
    }

    let supertrend: number;
    let trend: 'uptrend' | 'downtrend';

    if (currentClose <= finalUB) {
      supertrend = finalUB;
      trend = 'downtrend';
    } else {
      supertrend = finalLB;
      trend = 'uptrend';
    }

    return {
      supertrend,
      trend,
      upperBand: finalUB,
      lowerBand: finalLB,
      atr: atr[atr.length - 1],
    };
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   */
  calculateEMA(data: number[], period: number): number[] | null {
    if (data.length < period) return null;

    const k = 2 / (period + 1);
    const ema: number[] = [];

    // SMA for first EMA value
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i];
    }
    ema.push(sum / period);

    // Subsequent EMA values
    for (let i = period; i < data.length; i++) {
      ema.push((data[i] - ema[ema.length - 1]) * k + ema[ema.length - 1]);
    }

    return ema;
  }

  /**
   * Calculate ATR (Average True Range)
   */
  calculateATR(high: number[], low: number[], close: number[], period = this.config.atrPeriod): number[] {
    const tr: number[] = [];

    for (let i = 1; i < high.length; i++) {
      const tr1 = high[i] - low[i];
      const tr2 = Math.abs(high[i] - close[i - 1]);
      const tr3 = Math.abs(low[i] - close[i - 1]);
      tr.push(Math.max(tr1, tr2, tr3));
    }

    if (tr.length === 0) return [];

    // Calculate SMA of TR
    const atr: number[] = [];
    let sum = 0;
    for (let i = 0; i < period && i < tr.length; i++) {
      sum += tr[i];
    }
    atr.push(sum / Math.min(period, tr.length));

    // Subsequent ATR values
    for (let i = period; i < tr.length; i++) {
      atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
    }

    return atr;
  }

  /**
   * Calculate volatility
   */
  calculateVolatility(close: number[], period = 20): number {
    if (close.length < period) return 0;

    const recentClose = close.slice(-period);
    const returns: number[] = [];

    for (let i = 1; i < recentClose.length; i++) {
      returns.push((recentClose[i] - recentClose[i - 1]) / recentClose[i - 1]);
    }

    if (returns.length === 0) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;

    return Math.sqrt(variance) * 100;
  }

  /**
   * Check if current time is within trading hours
   */
  isWithinTradingHours(currentTime: string): boolean {
    if (!currentTime) return true;

    // Handle full ISO string or Date timestamp
    let timeStr = currentTime;
    if (timeStr.includes('T')) {
      const date = new Date(timeStr);
      const hours = String(date.getHours()).padStart(2, '0');
      const mins = String(date.getMinutes()).padStart(2, '0');
      timeStr = `${hours}:${mins}`;
    }

    const parts = timeStr.split(':');
    if (parts.length < 2) return true;

    const [startH, startM] = this.config.tradingHours.start.split(':').map(Number);
    const [endH, endM] = this.config.tradingHours.end.split(':').map(Number);
    const currH = Number(parts[0]);
    const currM = Number(parts[1]);

    const currMinutes = currH * 60 + currM;
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currMinutes >= startMinutes && currMinutes <= endMinutes;
  }

  /**
   * Calculate position size based on risk
   */
  calculatePositionSize(entryPrice: number, stopLoss: number, accountBalance: number): number {
    const riskAmount = accountBalance * this.config.riskPerTrade;
    const riskPips = Math.abs(entryPrice - stopLoss);
    if (riskPips <= 0) return 0;
    const positionSize = Math.floor(riskAmount / riskPips);

    return positionSize;
  }

  /**
   * Update price data cache
   */
  updatePriceData(candleData: CandleInput) {
    this.priceData.open.push(candleData.open);
    this.priceData.high.push(candleData.high);
    this.priceData.low.push(candleData.low);
    this.priceData.close.push(candleData.close);
    this.priceData.volume.push(candleData.volume || 0);

    if (this.priceData.close.length > this.config.lookbackPeriod) {
      this.priceData.open.shift();
      this.priceData.high.shift();
      this.priceData.low.shift();
      this.priceData.close.shift();
      this.priceData.volume.shift();
    }
  }

  /**
   * Generate trading signals
   */
  generateSignals(
    candleData: CandleInput,
    accountBalance: number = 100000,
    currentTime: string = '10:00'
  ): SignalResult {
    if (!this.isWithinTradingHours(currentTime)) {
      return { signal: 'NONE', reason: 'Outside trading hours' };
    }

    if (this.state.dailyPnL < -(accountBalance * this.config.maxDailyLoss)) {
      this.state.canTrade = false;
      return { signal: 'NONE', reason: 'Daily loss limit reached' };
    }

    // Update price data
    this.updatePriceData(candleData);

    // Check volume
    if ((candleData.volume || 0) < this.config.minVolume) {
      return { signal: 'NONE', reason: 'Insufficient volume' };
    }

    // Calculate indicators
    const macd = this.calculateMACD(this.priceData.close);
    const supertrend = this.calculateAdaptiveSupertrend(
      this.priceData.high,
      this.priceData.low,
      this.priceData.close,
      this.priceData.volume
    );

    if (!macd || !supertrend) {
      return { signal: 'NONE', reason: 'Insufficient data for indicators' };
    }

    const currentPrice = candleData.close;
    const previousMACD = macd.macdPrev;
    const currentMACD = macd.macdLine;

    let signal: 'BUY' | 'SELL' | 'EXIT_BUY' | 'EXIT_SELL' | 'NONE' = 'NONE';
    let signalDetails: SignalDetails = {};

    // ENTRY SIGNALS
    if (!this.state.isInPosition) {
      // BUY Signal
      if (
        supertrend.trend === 'uptrend' &&
        previousMACD < macd.signalPrev &&
        currentMACD > macd.signalLine &&
        macd.histogram > 0
      ) {
        const stopLoss = supertrend.lowerBand;
        const positionSize = this.calculatePositionSize(currentPrice, stopLoss, accountBalance);

        signal = 'BUY';
        signalDetails = {
          entryPrice: currentPrice,
          stopLoss,
          takeProfit: currentPrice + (currentPrice - stopLoss) * 2, // Risk:Reward 1:2
          positionSize,
          reason: 'MACD bullish crossover + SuperTrend uptrend',
          superTrendLevel: supertrend.supertrend,
          macdHistogram: macd.histogram,
        };
      }
      // SELL Signal
      else if (
        supertrend.trend === 'downtrend' &&
        previousMACD > macd.signalPrev &&
        currentMACD < macd.signalLine &&
        macd.histogram < 0
      ) {
        const stopLoss = supertrend.upperBand;
        const positionSize = this.calculatePositionSize(currentPrice, stopLoss, accountBalance);

        signal = 'SELL';
        signalDetails = {
          entryPrice: currentPrice,
          stopLoss,
          takeProfit: currentPrice - (stopLoss - currentPrice) * 2, // Risk:Reward 1:2
          positionSize,
          reason: 'MACD bearish crossover + SuperTrend downtrend',
          superTrendLevel: supertrend.supertrend,
          macdHistogram: macd.histogram,
        };
      }
    }
    // EXIT SIGNALS
    else {
      const isLong = this.state.currentTrend === 'BUY' || this.state.currentTrend === 'uptrend';
      const isShort = this.state.currentTrend === 'SELL' || this.state.currentTrend === 'downtrend';

      if (isLong) {
        const stopLoss = this.state.stopLoss ?? 0;
        const takeProfit = this.state.takeProfit ?? Infinity;

        if (currentPrice <= stopLoss) {
          signal = 'EXIT_BUY';
          signalDetails = {
            exitPrice: currentPrice,
            reason: 'Stop loss triggered',
            pnl: (currentPrice - (this.state.entryPrice ?? currentPrice)) * (this.state.positionSize ?? 1),
          };
        } else if (currentPrice >= takeProfit) {
          signal = 'EXIT_BUY';
          signalDetails = {
            exitPrice: currentPrice,
            reason: 'Take profit reached',
            pnl: (currentPrice - (this.state.entryPrice ?? currentPrice)) * (this.state.positionSize ?? 1),
          };
        } else if (
          supertrend.trend === 'downtrend' ||
          (previousMACD > macd.signalPrev && currentMACD < macd.signalLine)
        ) {
          signal = 'EXIT_BUY';
          signalDetails = {
            exitPrice: currentPrice,
            reason: 'Trend reversal / MACD bearish crossover',
            pnl: (currentPrice - (this.state.entryPrice ?? currentPrice)) * (this.state.positionSize ?? 1),
          };
        }
      } else if (isShort) {
        const stopLoss = this.state.stopLoss ?? Infinity;
        const takeProfit = this.state.takeProfit ?? 0;

        if (currentPrice >= stopLoss) {
          signal = 'EXIT_SELL';
          signalDetails = {
            exitPrice: currentPrice,
            reason: 'Stop loss triggered',
            pnl: ((this.state.entryPrice ?? currentPrice) - currentPrice) * (this.state.positionSize ?? 1),
          };
        } else if (currentPrice <= takeProfit) {
          signal = 'EXIT_SELL';
          signalDetails = {
            exitPrice: currentPrice,
            reason: 'Take profit reached',
            pnl: ((this.state.entryPrice ?? currentPrice) - currentPrice) * (this.state.positionSize ?? 1),
          };
        } else if (
          supertrend.trend === 'uptrend' ||
          (previousMACD < macd.signalPrev && currentMACD > macd.signalLine)
        ) {
          signal = 'EXIT_SELL';
          signalDetails = {
            exitPrice: currentPrice,
            reason: 'Trend reversal / MACD bullish crossover',
            pnl: ((this.state.entryPrice ?? currentPrice) - currentPrice) * (this.state.positionSize ?? 1),
          };
        }
      }
    }

    return {
      signal,
      reason: signalDetails.reason || (signal === 'NONE' ? 'No signal condition met' : signal),
      ...signalDetails,
    };
  }

  /**
   * Execute trade and update internal state
   */
  executeTrade(signal: string, signalDetails: SignalDetails, currentTime: string = '10:00') {
    if (signal === 'BUY' || signal === 'SELL') {
      this.state.isInPosition = true;
      this.state.entryPrice = signalDetails.entryPrice ?? null;
      this.state.entryTime = currentTime;
      this.state.positionSize = signalDetails.positionSize ?? null;
      this.state.stopLoss = signalDetails.stopLoss ?? null;
      this.state.takeProfit = signalDetails.takeProfit ?? null;
      this.state.currentTrend = signal as any;
      this.emit('trade_entry', { signal, ...signalDetails, time: currentTime });
    } else if (signal === 'EXIT_BUY' || signal === 'EXIT_SELL') {
      const pnl = signalDetails.pnl || 0;
      this.state.dailyPnL += pnl;

      const tradeRecord: TradeRecord = {
        type: this.state.currentTrend,
        entryPrice: this.state.entryPrice,
        exitPrice: signalDetails.exitPrice ?? 0,
        entryTime: this.state.entryTime,
        exitTime: currentTime,
        size: this.state.positionSize,
        pnl,
        reason: signalDetails.reason || 'Exit signal',
      };

      this.state.trades.push(tradeRecord);
      this.state.isInPosition = false;
      this.state.entryPrice = null;
      this.state.entryTime = null;
      this.state.positionSize = null;
      this.state.stopLoss = null;
      this.state.takeProfit = null;
      this.state.currentTrend = null;
      this.emit('trade_exit', tradeRecord);
    }
  }

  /**
   * Ingest a candle, check signals, execute trades, and emit events
   */
  onCandle(
    candleData: CandleInput,
    accountBalance: number = 100000,
    currentTime: string = '10:00'
  ): SignalResult {
    const signalResult = this.generateSignals(candleData, accountBalance, currentTime);
    if (signalResult.signal !== 'NONE') {
      this.emit('signal', signalResult);
      this.executeTrade(signalResult.signal, signalResult, currentTime);
    }
    return signalResult;
  }

  /**
   * Reset daily state
   */
  resetDailyState() {
    this.state.dailyPnL = 0;
    this.state.trades = [];
    this.state.canTrade = true;
    this.state.isInPosition = false;
    this.state.entryPrice = null;
    this.state.entryTime = null;
    this.state.positionSize = null;
    this.state.stopLoss = null;
    this.state.takeProfit = null;
    this.state.currentTrend = null;
  }
}

export default NiftyMacdAdaptiveSupertrend;
