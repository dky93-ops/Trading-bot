import axios from 'axios';
import { EnhancedDataManager } from './enhanced-data-manager.js';
import { Candle } from './types.js';

export class UpstoxDataFetcher {
  private accessToken: string;
  private dataManager: EnhancedDataManager;
  private lastCandleFetch: Record<string, number> = {};
  private fetchInterval = 60000; // 60 seconds between fetches for same timeframe

  constructor(accessToken: string, dataManager: EnhancedDataManager) {
    this.accessToken = accessToken;
    this.dataManager = dataManager;
  }

  /**
   * Fetch multi-timeframe candle data from Upstox API
   */
  async fetchHistoricalCandles(
    instrumentKey: string,
    timeframes: number[] = [1, 3, 5, 15, 60]
  ): Promise<Record<number, Candle[]>> {
    const results: Record<number, Candle[]> = {};

    for (const timeframe of timeframes) {
      try {
        const key = `${instrumentKey}_${timeframe}`;
        const lastFetch = this.lastCandleFetch[key] || 0;
        
        // Throttle to avoid rate limits
        if (Date.now() - lastFetch < this.fetchInterval) {
          continue;
        }

        const candles = await this.fetchCandlesForTimeframe(
          instrumentKey,
          timeframe,
          200
        );
        results[timeframe] = candles;
        this.lastCandleFetch[key] = Date.now();

        // Record in data manager
        for (const candle of candles) {
          this.dataManager.recordCandle(
            this.extractInstrumentName(instrumentKey),
            timeframe,
            candle
          );
        }
      } catch (e) {
        console.error(`Failed to fetch ${timeframe}m candles:`, e);
      }
    }

    return results;
  }

  /**
   * Fetch candles for a specific timeframe
   */
  private async fetchCandlesForTimeframe(
    instrumentKey: string,
    timeframeMinutes: number,
    limit: number = 200
  ): Promise<Candle[]> {
    try {
      const endpoint = `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(
        instrumentKey
      )}/minutes/${timeframeMinutes}`;

      const response = await axios.get(endpoint, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.accessToken}`
        },
        timeout: 5000
      });

      if (
        response.data &&
        response.data.status === 'success' &&
        response.data.data &&
        Array.isArray(response.data.data.candles)
      ) {
        return response.data.data.candles
          .slice(0, limit)
          .map((c: any) => ({
            timestamp: c[0],
            open: Number(c[1]),
            high: Number(c[2]),
            low: Number(c[3]),
            close: Number(c[4]),
            volume: Number(c[5]) || 0
          }))
          .sort(
            (a: any, b: any) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
      }
    } catch (error: any) {
      const errCode = error.response?.data?.errors?.[0]?.errorCode || error.response?.data?.errors?.[0]?.error_code;
      if (errCode === 'UDAPI1087') {
        console.warn(`Upstox API: Invalid instrument key (${instrumentKey}) - skipping candles`);
        return [];
      }
      console.error(`Upstox API error for ${timeframeMinutes}m candles:`, error.message);
      if (error.response?.status === 429) {
        throw new Error('RATE_LIMIT');
      }
    }

    return [];
  }

  /**
   * Fetch full option chain with all columns
   */
  async fetchFullOptionChain(
    instrumentKey: string,
    expiryDate: string
  ): Promise<any[]> {
    try {
      const response = await axios.get(
        `https://api.upstox.com/v2/option/chain`,
        {
          params: {
            instrument_key: instrumentKey,
            expiry_date: expiryDate
          },
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.accessToken}`
          },
          timeout: 5000
        }
      );

      if (
        response.data &&
        response.data.status === 'success' &&
        Array.isArray(response.data.data)
      ) {
        // Sort by strike price
        return response.data.data.sort(
          (a: any, b: any) =>
            Number(a.strike_price) - Number(b.strike_price)
        );
      }
    } catch (error: any) {
      const errCode = error.response?.data?.errors?.[0]?.errorCode || error.response?.data?.errors?.[0]?.error_code;
      if (errCode === 'UDAPI1087') {
        console.warn(`Upstox API: Invalid instrument key (${instrumentKey}) - skipping option chain`);
        return [];
      }
      console.error('Failed to fetch option chain:', error.message);
    }

    return [];
  }

  /**
   * Extract and record all premium data from option chain
   */
  recordOptionChainData(chainData: any[]): void {
    const timestamp = Date.now();

    for (const row of chainData) {
      const strike = Number(row.strike_price);
      if (!Number.isFinite(strike)) continue;

      // Record CALL premium
      if (row.call_options) {
        const ce = row.call_options;
        const md = ce.market_data || {};
        const greeks = ce.option_greeks || {};

        this.dataManager.recordPremium(
          strike,
          'CALL',
          Number(md.ltp ?? md.last_price),
          Number(md.bid_price ?? md.bid),
          Number(md.ask_price ?? md.ask),
          Number(greeks.iv),
          Number(greeks.delta),
          Number(greeks.theta),
          timestamp
        );
      }

      // Record PUT premium
      if (row.put_options) {
        const pe = row.put_options;
        const md = pe.market_data || {};
        const greeks = pe.option_greeks || {};

        this.dataManager.recordPremium(
          strike,
          'PUT',
          Number(md.ltp ?? md.last_price),
          Number(md.bid_price ?? md.bid),
          Number(md.ask_price ?? md.ask),
          Number(greeks.iv),
          Number(greeks.delta),
          Number(greeks.theta),
          timestamp
        );
      }
    }
  }

  /**
   * Record spot price tick
   */
  recordSpotPrice(price: number, volume?: number): void {
    this.dataManager.recordSpotPrice(price, volume, Date.now());
  }

  /**
   * Get data manager instance
   */
  getDataManager(): EnhancedDataManager {
    return this.dataManager;
  }

  private extractInstrumentName(instrumentKey: string): string {
    if (instrumentKey.includes('Nifty 50')) return 'NIFTY';
    if (instrumentKey.includes('Nifty Bank')) return 'BANKNIFTY';
    if (instrumentKey.includes('India VIX')) return 'VIX';
    return 'UNKNOWN';
  }
}
