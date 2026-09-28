/**
 * NIFTY MACD + Adaptive SuperTrend Strategy
 * Version 1.0
 * 
 * This strategy combines:
 * 1. MACD (Moving Average Convergence Divergence) for trend confirmation
 * 2. Adaptive SuperTrend for dynamic support/resistance and trend reversal signals
 * 3. Risk management with adaptive position sizing
 */

const { EventEmitter } = require('events');
let TALib;
try { TALib = require('talib'); } catch (_) { TALib = null; }

class NiftyMacdAdaptiveSupertrend extends EventEmitter {
  constructor(config = {}) {
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
  calculateMACD(closes) {
    if (closes.length < this.config.macdSlow + this.config.macdSignal) {
      return null;
    }

    const ema12 = this.calculateEMA(closes, this.config.macdFast);
    const ema26 = this.calculateEMA(closes, this.config.macdSlow);
    
    const macdLine = ema12.map((val, idx) => val - ema26[idx]);
    const signalLine = this.calculateEMA(macdLine, this.config.macdSignal);
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
  calculateAdaptiveSupertrend(high, low, close, volume) {
    if (high.length < this.config.atrPeriod * 2) {
      return null;
    }

    // Calculate ATR (Average True Range)
    const atr = this.calculateATR(high, low, close);
    
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

    let supertrend;
    let trend;
    
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
  calculateEMA(data, period) {
    if (data.length < period) return null;
    
    const k = 2 / (period + 1);
    const ema = [];
    
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
  calculateATR(high, low, close, period = this.config.atrPeriod) {
    const tr = [];
    
    for (let i = 1; i < high.length; i++) {
      const tr1 = high[i] - low[i];
      const tr2 = Math.abs(high[i] - close[i - 1]);
      const tr3 = Math.abs(low[i] - close[i - 1]);
      tr.push(Math.max(tr1, tr2, tr3));
    }
    
    // Calculate SMA of TR
    const atr = [];
    let sum = 0;
    for (let i = 0; i < period && i < tr.length; i++) {
      sum += tr[i];
    }
    atr.push(sum / period);
    
    // Subsequent ATR values
    for (let i = period; i < tr.length; i++) {
      atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
    }
    
    return atr;
  }

  /**
   * Calculate volatility
   */
  calculateVolatility(close, period = 20) {
    if (close.length < period) return 0;
    
    const recentClose = close.slice(-period);
    const returns = [];
    
    for (let i = 1; i < recentClose.length; i++) {
      returns.push((recentClose[i] - recentClose[i - 1]) / recentClose[i - 1]);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * 100;
  }

  /**
   * Check if current time is within trading hours
   */
  isWithinTradingHours(currentTime) {
    const [startH, startM] = this.config.tradingHours.start.split(':').map(Number);
    const [endH, endM] = this.config.tradingHours.end.split(':').map(Number);
    const [currH, currM] = currentTime.split(':').map(Number);
    
    const currMinutes = currH * 60 + currM;
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    return currMinutes >= startMinutes && currMinutes <= endMinutes;
  }

  /**
   * Calculate position size based on risk
   */
  calculatePositionSize(entryPrice, stopLoss, accountBalance) {
    const riskAmount = accountBalance * this.config.riskPerTrade;
    const riskPips = Math.abs(entryPrice - stopLoss);
    const positionSize = Math.floor(riskAmount / riskPips);
    
    return positionSize;
  }

  /**
   * Generate trading signals
   */
  generateSignals(candleData, accountBalance, currentTime) {
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
    if (candleData.volume < this.config.minVolume) {
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

    let signal = 'NONE';
    let signalDetails = {};

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
    else if (this.state.isInPosition) {
      // Stop Loss / Take Profit check is handled separately
      
      // Trend reversal exit
      if (
        (this.state.currentTrend === 'uptrend' && supertrend.trend === 'downtrend') ||
        (this.state.currentTrend === 'downtrend' && supertrend.trend === 'uptrend')
      ) {
        signal = 'EXIT';
        signalDetails = {
          reason: 'SuperTrend trend reversal',
          currentTrend: supertrend.trend,
        };
      }
    }

    return {
      signal,
      indicators: {
        macd: macd.macdLine,
        signal: macd.signalLine,
        histogram: macd.histogram,
        supertrend: supertrend.supertrend,
        trend: supertrend.trend,
        atr: supertrend.atr,
      },
      ...signalDetails,
    };
  }

  /**
   * Update price data cache
   */
  updatePriceData(candle) {
    this.priceData.close.push(candle.close);
    this.priceData.high.push(candle.high);
    this.priceData.low.push(candle.low);
    this.priceData.open.push(candle.open);
    this.priceData.volume.push(candle.volume);

    // Keep only necessary data points
    const maxLength = this.config.lookbackPeriod + this.config.macdSlow;
    if (this.priceData.close.length > maxLength) {
      this.priceData.close.shift();
      this.priceData.high.shift();
      this.priceData.low.shift();
      this.priceData.open.shift();
      this.priceData.volume.shift();
    }
  }

  /**
   * Execute trade based on signal
   */
  executeTrade(signal, signalData) {
    if (signal === 'BUY') {
      this.state.isInPosition = true;
      this.state.entryPrice = signalData.entryPrice;
      this.state.positionSize = signalData.positionSize;
      this.state.stopLoss = signalData.stopLoss;
      this.state.takeProfit = signalData.takeProfit;
      this.state.currentTrend = 'uptrend';
      this.state.entryTime = new Date();
      
      this.emit('trade', {
        type: 'BUY',
        entryPrice: this.state.entryPrice,
        positionSize: this.state.positionSize,
        stopLoss: this.state.stopLoss,
        takeProfit: this.state.takeProfit,
        timestamp: this.state.entryTime,
      });
    }
    else if (signal === 'SELL') {
      this.state.isInPosition = true;
      this.state.entryPrice = signalData.entryPrice;
      this.state.positionSize = signalData.positionSize;
      this.state.stopLoss = signalData.stopLoss;
      this.state.takeProfit = signalData.takeProfit;
      this.state.currentTrend = 'downtrend';
      this.state.entryTime = new Date();
      
      this.emit('trade', {
        type: 'SELL',
        entryPrice: this.state.entryPrice,
        positionSize: this.state.positionSize,
        stopLoss: this.state.stopLoss,
        takeProfit: this.state.takeProfit,
        timestamp: this.state.entryTime,
      });
    }
    else if (signal === 'EXIT') {
      this.exitPosition(signalData);
    }
  }

  /**
   * Exit current position
   */
  exitPosition(exitData) {
    if (!this.state.isInPosition) return;

    const trade = {
      entryPrice: this.state.entryPrice,
      exitPrice: exitData.exitPrice || this.state.entryPrice,
      positionSize: this.state.positionSize,
      type: this.state.currentTrend === 'uptrend' ? 'BUY' : 'SELL',
      entryTime: this.state.entryTime,
      exitTime: new Date(),
      reason: exitData.reason,
    };

    // Calculate PnL
    if (trade.type === 'BUY') {
      trade.pnl = (trade.exitPrice - trade.entryPrice) * trade.positionSize;
    } else {
      trade.pnl = (trade.entryPrice - trade.exitPrice) * trade.positionSize;
    }

    this.state.dailyPnL += trade.pnl;
    this.state.trades.push(trade);

    this.emit('exit', trade);

    // Reset position state
    this.state.isInPosition = false;
    this.state.entryPrice = null;
    this.state.positionSize = null;
    this.state.stopLoss = null;
    this.state.takeProfit = null;
    this.state.currentTrend = null;
  }

  /**
   * Check stop loss and take profit
   */
  checkStopLossAndTakeProfit(currentPrice) {
    if (!this.state.isInPosition) return;

    if (this.state.currentTrend === 'uptrend') {
      if (currentPrice <= this.state.stopLoss) {
        this.exitPosition({ 
          exitPrice: this.state.stopLoss, 
          reason: 'Stop Loss Hit' 
        });
      } else if (currentPrice >= this.state.takeProfit) {
        this.exitPosition({ 
          exitPrice: this.state.takeProfit, 
          reason: 'Take Profit Hit' 
        });
      }
    } else if (this.state.currentTrend === 'downtrend') {
      if (currentPrice >= this.state.stopLoss) {
        this.exitPosition({ 
          exitPrice: this.state.stopLoss, 
          reason: 'Stop Loss Hit' 
        });
      } else if (currentPrice <= this.state.takeProfit) {
        this.exitPosition({ 
          exitPrice: this.state.takeProfit, 
          reason: 'Take Profit Hit' 
        });
      }
    }
  }

  /**
   * Get strategy status
   */
  getStatus() {
    return {
      isInPosition: this.state.isInPosition,
      currentTrend: this.state.currentTrend,
      entryPrice: this.state.entryPrice,
      stopLoss: this.state.stopLoss,
      takeProfit: this.state.takeProfit,
      positionSize: this.state.positionSize,
      dailyPnL: this.state.dailyPnL,
      totalTrades: this.state.trades.length,
      canTrade: this.state.canTrade,
    };
  }

  /**
   * Reset daily stats
   */
  resetDaily() {
    this.state.dailyPnL = 0;
    this.state.trades = [];
    this.state.canTrade = true;
  }
}

module.exports = NiftyMacdAdaptiveSupertrend;
module.exports.default = NiftyMacdAdaptiveSupertrend;
module.exports.NiftyMacdAdaptiveSupertrend = NiftyMacdAdaptiveSupertrend;
