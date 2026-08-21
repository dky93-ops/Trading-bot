import { Candle } from './types.js';
import axios from 'axios';

export interface PremiumHistory {
  timestamp: number;
  strike: number;
  callLTP: number | undefined;
  putLTP: number | undefined;
  callBid: number | undefined;
  callAsk: number | undefined;
  putBid: number | undefined;
  putAsk: number | undefined;
  callIV: number | undefined;
  putIV: number | undefined;
  callDelta: number | undefined;
  putDelta: number | undefined;
  callTheta: number | undefined;
  putTheta: number | undefined;
}

export interface SpotPriceHistory {
  timestamp: number;
  price: number;
  volume?: number;
}

export interface CandleData extends Candle {
  timeframe: number; // in minutes
  volume: number;
}

export class EnhancedDataManager {
  private premiumHistory: Map<string, PremiumHistory[]> = new Map(); // key: "strike_CALL/PUT"
  private spotPriceHistory: SpotPriceHistory[] = [];
  private candleHistory: Map<string, CandleData[]> = new Map(); // key: "instrument_timeframe"
  private maxHistorySize = 5000;

  /**
   * Record a premium observation for a specific strike
   */
  public recordPremium(
    strike: number,
    side: 'CALL' | 'PUT',
    ltp: number | undefined,
    bid: number | undefined,
    ask: number | undefined,
    iv: number | undefined,
    delta: number | undefined,
    theta: number | undefined,
    timestamp: number = Date.now()
  ): void {
    const key = `${strike}_${side}`;
    const history = this.premiumHistory.get(key) || [];

    history.push({
      timestamp,
      strike,
      callLTP: side === 'CALL' ? ltp : undefined,
      putLTP: side === 'PUT' ? ltp : undefined,
      callBid: side === 'CALL' ? bid : undefined,
      callAsk: side === 'CALL' ? ask : undefined,
      putBid: side === 'PUT' ? bid : undefined,
      putAsk: side === 'PUT' ? ask : undefined,
      callIV: side === 'CALL' ? iv : undefined,
      putIV: side === 'PUT' ? iv : undefined,
      callDelta: side === 'CALL' ? delta : undefined,
      putDelta: side === 'PUT' ? delta : undefined,
      callTheta: side === 'CALL' ? theta : undefined,
      putTheta: side === 'PUT' ? theta : undefined
    });

    if (history.length > this.maxHistorySize) {
      history.shift();
    }

    this.premiumHistory.set(key, history);
  }

  /**
   * Get premium history for a strike
   */
  public getPremiumHistory(
    strike: number,
    side: 'CALL' | 'PUT',
    minutesBack: number = 60
  ): PremiumHistory[] {
    const key = `${strike}_${side}`;
    const history = this.premiumHistory.get(key) || [];
    const cutoffTime = Date.now() - minutesBack * 60 * 1000;
    return history.filter(h => h.timestamp >= cutoffTime);
  }

  /**
   * Record spot price tick
   */
  public recordSpotPrice(
    price: number,
    volume?: number,
    timestamp: number = Date.now()
  ): void {
    this.spotPriceHistory.push({ timestamp, price, volume });
    if (this.spotPriceHistory.length > this.maxHistorySize) {
      this.spotPriceHistory.shift();
    }
  }

  /**
   * Get spot price history
   */
  public getSpotPriceHistory(minutesBack: number = 60): SpotPriceHistory[] {
    const cutoffTime = Date.now() - minutesBack * 60 * 1000;
    return this.spotPriceHistory.filter(h => h.timestamp >= cutoffTime);
  }

  /**
   * Record candle data
   */
  public recordCandle(
    instrument: string,
    timeframe: number,
    candle: Candle
  ): void {
    const key = `${instrument}_${timeframe}`;
    const history = this.candleHistory.get(key) || [];

    history.push({
      ...candle,
      timeframe,
      volume: candle.volume || 0
    });

    if (history.length > this.maxHistorySize) {
      history.shift();
    }

    this.candleHistory.set(key, history);
  }

  /**
   * Get candles for an instrument and timeframe
   */
  public getCandles(
    instrument: string,
    timeframe: number,
    limit: number = 200
  ): CandleData[] {
    const key = `${instrument}_${timeframe}`;
    const history = this.candleHistory.get(key) || [];
    return history.slice(-limit).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Calculate premium trend for a strike
   */
  public getPremiumTrend(
    strike: number,
    side: 'CALL' | 'PUT',
    minutesBack: number = 10
  ): {
    direction: 'UP' | 'DOWN' | 'FLAT';
    strength: number; // 0-100
    ltpChange: number;
    average: number;
  } {
    const history = this.getPremiumHistory(strike, side, minutesBack);
    if (history.length < 2) {
      return { direction: 'FLAT', strength: 0, ltpChange: 0, average: 0 };
    }

    const ltpField = side === 'CALL' ? 'callLTP' : 'putLTP';
    const validPrices = history
      .map(h => side === 'CALL' ? h.callLTP : h.putLTP)
      .filter((p): p is number => Number.isFinite(p));

    if (validPrices.length < 2) {
      return { direction: 'FLAT', strength: 0, ltpChange: 0, average: 0 };
    }

    const firstPrice = validPrices[0];
    const lastPrice = validPrices[validPrices.length - 1];
    const average = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
    const ltpChange = lastPrice - firstPrice;
    const changePercent = (ltpChange / firstPrice) * 100;
    const strength = Math.min(100, Math.abs(changePercent) * 10);

    return {
      direction: ltpChange > 0 ? 'UP' : ltpChange < 0 ? 'DOWN' : 'FLAT',
      strength,
      ltpChange,
      average
    };
  }

  /**
   * Analyze momentum from candles
   */
  public analyzeCandleMomentum(
    instrument: string,
    timeframe: number,
    candles: number = 5
  ): {
    direction: 'UP' | 'DOWN' | 'NEUTRAL';
    strength: number;
    atr: number;
  } {
    const history = this.getCandles(instrument, timeframe, candles);
    if (history.length < candles) {
      return { direction: 'NEUTRAL', strength: 0, atr: 0 };
    }

    const closes = history.map(c => c.close);
    const highs = history.map(c => c.high);
    const lows = history.map(c => c.low);

    // Calculate ATR
    const trs = [];
    for (let i = 1; i < history.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    const atr = trs.reduce((a, b) => a + b, 0) / trs.length;

    // Determine direction
    const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
    const lastClose = closes[closes.length - 1];
    const firstClose = closes[0];
    const changePercent = ((lastClose - firstClose) / firstClose) * 100;
    const strength = Math.min(100, Math.abs(changePercent) * 20);

    return {
      direction: lastClose > sma ? 'UP' : lastClose < sma ? 'DOWN' : 'NEUTRAL',
      strength,
      atr
    };
  }

  /**
   * Get volatility (IV average)
   */
  public getAverageIV(
    side: 'CALL' | 'PUT',
    minutesBack: number = 5
  ): number {
    const allStrikes = Array.from(this.premiumHistory.keys())
      .filter(k => k.endsWith(`_${side}`))
      .map(k => Number(k.split('_')[0]));

    const ivValues: number[] = [];
    for (const strike of allStrikes) {
      const history = this.getPremiumHistory(strike, side, minutesBack);
      for (const h of history) {
        const iv = side === 'CALL' ? h.callIV : h.putIV;
        if (Number.isFinite(iv)) {
          ivValues.push(iv as number);
        }
      }
    }

    if (ivValues.length === 0) return 0;
    return ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
  }

  /**
   * Clear old history
   */
  public clearOldData(minutesBack: number = 480): void {
    const cutoffTime = Date.now() - minutesBack * 60 * 1000;

    // Clear premium history
    for (const [key, history] of this.premiumHistory.entries()) {
      const filtered = history.filter(h => h.timestamp >= cutoffTime);
      if (filtered.length === 0) {
        this.premiumHistory.delete(key);
      } else {
        this.premiumHistory.set(key, filtered);
      }
    }

    // Clear spot price history
    this.spotPriceHistory = this.spotPriceHistory.filter(
      h => h.timestamp >= cutoffTime
    );

    // Clear candle history
    for (const [key, history] of this.candleHistory.entries()) {
      const filtered = history.filter(
        h => new Date(h.timestamp).getTime() >= cutoffTime
      );
      if (filtered.length === 0) {
        this.candleHistory.delete(key);
      } else {
        this.candleHistory.set(key, filtered);
      }
    }
  }
}
