import axios from 'axios';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { StrategyEngine } from './strategy-engine.js';
import { AppSettings, AppState, OptionChainSnapshot, TradingSymbol, InternalSignal } from './types.js';
import { insertTick, seedHistoricalCandles } from '../db/market.js';

export class UpstoxService {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private pollingInterval: NodeJS.Timeout | null = null;
  private oneMinRecorderInterval: NodeJS.Timeout | null = null;
  private strategyEngine: StrategyEngine;
  public optionChainHistory: OptionChainSnapshot[] = [];
  private historyFilePath = path.join(process.cwd(), 'data', 'option_chain_history.json');
  
  private settings: AppSettings = {
    apiKey: process.env.UPSTOX_API_KEY || '',
    apiSecret: process.env.UPSTOX_API_SECRET || '',
    accessToken: process.env.UPSTOX_ACCESS_TOKEN || '',
    isTradingEnabled: true,
    nifty50Enabled: true,
    expiryDate: 'CURRENT',
    defaultLotsPerTrade: 1,
    maxActiveTrades: 1,
    DECISION_TIMEFRAME_MINUTES: 5,
    WALL_TOLERANCE_POINTS: 10,
    OPENING_RANGE_MINUTES: 15,
    MAX_OPTION_SPREAD_PERCENT: 1.5,
    MAX_OPTION_LOSS_PERCENT: 35,
    PREMIUM_CONFIRMATION_PERCENT: 1,
    OPENING_PREMIUM_CONFIRMATION_PERCENT: 1.5,
    WALL_OI_RATIO: 1.5,
    WALL_WEAKENING_PERCENT: 5,
    MAX_WALL_DISTANCE_ATR: 1.5,
    MIN_ENTRY_TIME_IST: '09:30',
    LAST_ENTRY_TIME_IST: '15:00',
    strategies: {
      openingTrap: { enabled: true, lotSize: 1 },
      failedRetest: { enabled: true, lotSize: 1 },
      continuationBreakdown: { enabled: true, lotSize: 1 },
      continuationBreakout: { enabled: true, lotSize: 1 },
      oiWallRejection: { enabled: true, lotSize: 1 },
      technicalConfluence: { enabled: true, lotSize: 1 },
    },
  };
  private hasBrokerCredentials(): boolean {
    return Boolean(
      process.env.UPSTOX_API_KEY &&
      process.env.UPSTOX_API_SECRET &&
      process.env.UPSTOX_ACCESS_TOKEN,
    );
  }

  public getPublicSettings() {
    const { apiKey: _apiKey, apiSecret: _apiSecret, accessToken: _accessToken, ...safe } =
      this.settings;
    return {
      ...safe,
      hasAccessToken: Boolean(this.settings.accessToken),
    };
  }

  private state: AppState = {
    optionChainTimestamp: 0,
    spotFeedTimestamp: 0,
    optionChainSnapshotTimestamp: 0, 
    nifty50: { lastPrice: 0, change: 0, timestamp: 0 },
    indiaVix: { lastPrice: 0, change: 0, timestamp: 0 },
    isConnected: false,
    signals: [],
    overallPnL: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    winRate: 0,
    totalTrades: 0,
    winningTrades: 0,
  };

  private errorCount = 0;
  private isPolling = false;
  private rateLimitBackoffUntil = 0;
  private maxErrorsBeforeExit = 10; // ~30 seconds if polling every 3s
  private lastSyncedMinuteBucket = 0;
  private candleSyncBackoffUntil = 0;
  private optionChainCache: Record<string, { timestamp: number, data: any }> = {};

  private nearestExpiryCache: Record<string, { date: string, timestamp: number }> = {};

  private async getNearestExpiry(instrumentKey: string): Promise<string> {
    const cached = this.nearestExpiryCache[instrumentKey];
    if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
      return cached.date;
    }
    
    try {
      const response = await axios.get(`https://api.upstox.com/v2/option/contract`, {
        params: { instrument_key: instrumentKey },

        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.settings.accessToken}`
        }
      });
      
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
         const expirys = [...new Set(response.data.data.map((c: any) => c.expiry))].sort();
         // Use IST current date for boundary checks
         const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
         const validExpirys = expirys.filter((e: any) => e >= todayIST);
         
         if (validExpirys.length > 0) {
            this.nearestExpiryCache[instrumentKey] = { date: validExpirys[0] as string, timestamp: Date.now() };
            return validExpirys[0] as string;
         } else if (expirys.length > 0) {
            // Fallback to latest available expiry if todayIST filter excludes past
            const latest = expirys[expirys.length - 1] as string;
            this.nearestExpiryCache[instrumentKey] = { date: latest, timestamp: Date.now() };
            return latest;
         }
      }
    } catch (e) {
      console.error('Error fetching contracts for expiry:', e);
    }
    
    // Fallback calculation in IST
    const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
    const targetDay = instrumentKey.includes('Nifty 50') ? 4 : 3;
    let daysToAdd = (targetDay - nowIST.getDay() + 7) % 7;
    
    if (daysToAdd === 0 && (nowIST.getHours() > 15 || (nowIST.getHours() === 15 && nowIST.getMinutes() >= 30))) {
        daysToAdd = 7;
    }
    const expiryDate = new Date(nowIST.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    return expiryDate.toISOString().split('T')[0];
  }


  private loadOptionChainHistoryFromDisk() {
    try {
      if (fs.existsSync(this.historyFilePath)) {
        const raw = fs.readFileSync(this.historyFilePath, 'utf-8');
        const json = JSON.parse(raw);
        if (Array.isArray(json)) {
          this.optionChainHistory = json;
          console.log(`Loaded ${json.length} recorded 1-min option chain snapshots from disk.`);
        }
      }
    } catch (e) {
      console.error("Failed to load option chain history from disk:", e);
    }
  }

  private saveOptionChainHistoryToDisk() {
    try {
      const dir = path.dirname(this.historyFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.historyFilePath, JSON.stringify(this.optionChainHistory, null, 2), 'utf-8');
    } catch (e) {
      console.error("Failed to save option chain history to disk:", e);
    }
  }

  private startOneMinOptionChainRecorder() {
    if (this.oneMinRecorderInterval) {
      clearInterval(this.oneMinRecorderInterval);
    }

    console.log("Starting 1-Minute Option Chain Recording Engine...");
    
    // Trigger immediately once, then schedule every 60 seconds (1 minute)
    this.recordOneMinOptionChain();
    this.oneMinRecorderInterval = setInterval(() => {
      this.recordOneMinOptionChain();
    }, 60000);
  }

  private async recordOneMinOptionChain() {
    if (!this.hasBrokerCredentials()) return;
    if (!this.settings.accessToken) return;

    // Only record during market hours
    if (!this.strategyEngine.isMarketOpen()) {
      return;
    }

    try {
      const niftyExpiry = await this.getNearestExpiry('NSE_INDEX|Nifty 50');
      await this.getOptionChain('NSE_INDEX|Nifty 50', niftyExpiry);
    } catch (e) {
      console.error("Error in 1-min option chain recording tick:", e);
    }
  }

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.strategyEngine = new StrategyEngine(
      this.settings, 
      this.state, 
      this.fetchOptionData.bind(this),
      this.getOptionChain.bind(this),
      this.getNearestExpiry.bind(this),
      this.getOptionChainHistory.bind(this)
    );

    // Load recorded 1-minute option chain history from disk
    this.loadOptionChainHistoryFromDisk();
    
    if (!this.hasBrokerCredentials()) {
      this.state.apiError =
        'Blocked: Upstox runtime credentials are missing.';
    }

    if (this.hasBrokerCredentials()) {
      this.startPolling();
    }

    // Always run the 1-minute Option Chain recording loop during server runtime
    if (this.hasBrokerCredentials()) {
      this.startOneMinOptionChainRecorder();
    }

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'STATE_UPDATE', data: this.state }));
      
      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  public resetSignals() {
    this.state.signals = [];
    this.strategyEngine.activeSignals.clear();
    this.state.overallPnL = 0;
    this.state.winRate = 0;
    this.state.totalTrades = 0;
    this.state.winningTrades = 0;
    this.broadcastState();
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  updateSettings(newSettings: Partial<AppSettings>) {
    this.settings = {
      ...this.settings,
      ...newSettings,
      DECISION_TIMEFRAME_MINUTES: 5,
    };
    if (newSettings.accessToken) {
      this.state.apiError = undefined;
    }
    this.strategyEngine.updateSettings(this.settings);
    this.broadcast({ type: 'SETTINGS_UPDATE', data: this.getPublicSettings() });
    
    // Auto-restart polling if token changes and we are not polling
    if (this.settings.accessToken && !this.pollingInterval) {
      this.startPolling();
    }
  }

  getState(): AppState {
    return this.state;
  }

  async getExpiries(instrumentKey: string): Promise<string[]> {
    try {
      const response = await axios.get(`https://api.upstox.com/v2/option/contract`, {
        params: { instrument_key: instrumentKey },

        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.settings.accessToken}`
        }
      });
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
        const expirys = [...new Set(response.data.data.map((c: any) => c.expiry))].sort().filter((e: any) => e >= todayIST) as string[];
        if (expirys.length > 0) return expirys;
      }
    } catch (e) {
      console.error('Error fetching expiries:', e);
    }
    const nearest = await this.getNearestExpiry(instrumentKey);
    return [nearest];
  }

  async getOptionChain(instrumentKey: string, expiryDate?: string) {
    if (!expiryDate || expiryDate === 'CURRENT' || expiryDate === 'undefined') {
      expiryDate = await this.getNearestExpiry(instrumentKey);
    }
    const cacheKey = `${instrumentKey}-${expiryDate}`;
    const cached = this.optionChainCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < 1200) { // 1.2s cache for high frequency updates
       return cached.data;
    }
    
    if (this.settings.accessToken) {
      try {
        const response = await axios.get(`https://api.upstox.com/v2/option/chain`, {
          params: {
            instrument_key: instrumentKey,
            expiry_date: expiryDate
          },
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.settings.accessToken}`
          },
          timeout: 5000
        });

        if (response.data && response.data.status === 'success' && Array.isArray(response.data.data) && response.data.data.length > 0) {
          const rawRows = response.data.data;

          // Ensure strikes are strictly sorted ascending for accurate table matching
          rawRows.sort((a: any, b: any) => Number(a.strike_price) - Number(b.strike_price));

          // Sync underlying spot price into app state
          if (rawRows.length > 0 && rawRows[0].underlying_spot_price) {
            const spot = Number(rawRows[0].underlying_spot_price);
            if (instrumentKey.includes('Nifty Bank')) {
              
            } else if (instrumentKey.includes('Nifty 50')) {
              this.state.optionChainTimestamp = Date.now();
              this.state.optionChainSnapshotTimestamp = this.state.optionChainTimestamp;
            }
          }

          this.state.apiError = undefined;
          const result = { status: "success", data: rawRows, source: "UPSTOX_REALTIME" };
          this.optionChainCache[cacheKey] = { timestamp: Date.now(), data: result };

          // Record snapshot for backtest / analysis replay
          this.recordOptionChainSnapshot(instrumentKey, expiryDate, rawRows);

          return result;
        }
      } catch (error: any) {
        console.error("Upstox Option Chain realtime API error:", error.response?.data || error.message);
        const errObj = error.response?.data?.errors?.[0];
        const code = errObj?.errorCode || errObj?.error_code;
        const msg = errObj?.message || error.message;

        let formattedMsg = msg;
        if (code === 'UDAPI10005' || error.response?.status === 401) {
          formattedMsg = "Upstox Access Token is invalid or expired (UDAPI10005). Please paste a new token in Settings.";
        } else if (code === 'UDAPI100042' || error.response?.status === 429) {
          this.rateLimitBackoffUntil = Date.now() + 6000;
          formattedMsg = "Upstox API Rate Limit reached (UDAPI100042). Throttling requests automatically...";
        } else if (code) {
          formattedMsg = `Upstox API Error (${code}): ${msg}`;
        }

        this.state.apiError = formattedMsg;
        return { 
          status: "error", 
          message: formattedMsg, 
          data: [] 
        };
      }
    }

    const missingMsg = "Upstox Access Token missing or unconfigured. Paste your daily Upstox Access Token in Settings.";
    this.state.apiError = missingMsg;
    return { 
      status: "error", 
      message: missingMsg, 
      data: [] 
    };
  }

  private async fetchOptionData(index: TradingSymbol, type: 'CE' | 'PE', spotPrice: number, strikeOffset: number = 0) {
    try {
      const instrumentKey = 'NSE_INDEX|Nifty 50';
      let expiry = this.settings.expiryDate;
      if (!expiry || expiry === 'CURRENT') {
        expiry = await this.getNearestExpiry(instrumentKey);
      }
      const chainResponse = await this.getOptionChain(instrumentKey, expiry);
      if (!chainResponse || !chainResponse.data) return null;
      
      const chainData = chainResponse.data;
      const strikeStep = 50;
      const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;
      const targetStrike = atmStrike + (strikeOffset * strikeStep);
      
      const optionData = chainData.find((row: any) => Number(row.strike_price) === targetStrike);
      if (!optionData) return null;

      const optObj = type === 'CE' ? optionData.call_options : optionData.put_options;
      if (!optObj) return null;

      const m = optObj.market_data || {};
      const price = Number(m.ltp ?? m.last_price ?? 0);
      return {
        price,
        instrumentKey: optObj.instrument_key,
        strike: targetStrike,
        bidPrice: Number(m.bid_price ?? 0),
        askPrice: Number(m.ask_price ?? 0),
        bidQty: Number(m.bid_qty ?? 0),
        askQty: Number(m.ask_qty ?? 0),
        volume: Number(m.volume ?? 0),
        iv: Number(optObj.option_greeks?.iv ?? 0)
      };
    } catch (error) {
      console.error("Error fetching option data for signal", error);
    }
    return null;
  }

  
  

  private async syncHistoricalCandles() {
    if (!this.settings.accessToken) return;
    if (Date.now() < this.candleSyncBackoffUntil) return;
    try {
      const decisionMinutes = Number(
        this.settings.DECISION_TIMEFRAME_MINUTES || 5,
      );

      const response = await axios.get(
        `https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/${decisionMinutes}`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.settings.accessToken}`,
          },
          timeout: 5000,
        },
      );
      if (response.data && response.data.status === 'success' && response.data.data && response.data.data.candles) {
        const rawCandles = response.data.data.candles;
        await seedHistoricalCandles('NIFTY', decisionMinutes, rawCandles);
        await seedHistoricalCandles('NIFTY', 1, rawCandles);
        await seedHistoricalCandles('NIFTY', 3, rawCandles);
        await seedHistoricalCandles('NIFTY', 5, rawCandles);
        await seedHistoricalCandles('NIFTY', 15, rawCandles);
      }
    } catch(e: any) {
      if (e.response?.status === 429) {
        this.candleSyncBackoffUntil = Date.now() + 10000;
      }
      console.error("Failed to sync historical candles:", e.response?.data || e.message);
    }
  }

  public async startPolling() {

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    console.log("Starting Upstox Market Data Polling...");
    this.syncHistoricalCandles().catch(console.error);
    // Upstox restricts heavy polling, poll every 2.5 seconds.
    this.pollingInterval = setInterval(() => this.pollData(), 2500);
  }
  
  public stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.state.isConnected = false;
    this.broadcastState();
  }

  private async pollData() {

    if (this.isPolling) return; // Prevent concurrent/overlapping requests
    if (Date.now() < this.rateLimitBackoffUntil) return; // Wait during rate limit backoff

    this.isPolling = true;
    let success = false;
    let isRateLimit = false;

    if (this.settings.accessToken) {
      try {
        const activeOptionKeys = Array.from(this.strategyEngine.activeSignals.values())
          .map(s => s.instrumentKey ? s.instrumentKey.replace(':', '|') : '')
          .filter(Boolean);

        const keysList = [
          'NSE_INDEX|Nifty 50', 
          'NSE_INDEX|India VIX',
          ...activeOptionKeys
        ];

        // Deduplicate and encode instrument keys
        const instrumentKeys = Array.from(new Set(keysList)).join(',');

        const response = await axios.get(`https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKeys)}`, {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.settings.accessToken}`
          },
          timeout: 4000
        });

        if (response.data && response.data.status === 'success' && response.data.data) {
          const data = response.data.data;
          this.state.isConnected = true;
          this.errorCount = 0; // reset errors

          if (data['NSE_INDEX:Nifty 50']) {
            const tick = data['NSE_INDEX:Nifty 50'];
            const niftyLast = Number(tick.last_price);
            const niftyTimestamp = Date.now();
            if (Number.isFinite(niftyLast) && niftyLast > 0) {
              this.state.spotFeedTimestamp = niftyTimestamp;
              this.state.nifty50 = {
                lastPrice: niftyLast,
                change: Number(tick.net_change || 0),
                timestamp: niftyTimestamp,
              };
              await insertTick('NIFTY', niftyLast, niftyTimestamp);
            }
          }
          if (data['NSE_INDEX:India VIX']) {
            const tick = data['NSE_INDEX:India VIX'];
            this.state.indiaVix = {
              lastPrice: tick.last_price,
              change: tick.net_change,
              timestamp: Date.now()
            };
          }
            
          // Update live prices for active options using exact instrument_token match from Upstox quote response
          const quoteList = Object.values(data) as any[];
          for (const signal of this.strategyEngine.activeSignals.values()) {
            if (signal.instrumentKey) {
              const matchingQuote = quoteList.find((q: any) => 
                q && (
                  q.instrument_token === signal.instrumentKey ||
                  q.instrument_token === signal.instrumentKey.replace(':', '|') ||
                  q.instrument_token === signal.instrumentKey.replace('|', ':')
                )
              );
              if (matchingQuote && matchingQuote.last_price !== undefined) {
                signal.latestPrice = matchingQuote.last_price;
              }
            }
          }

          this.state.apiError = undefined;
          success = true;
        }
      } catch (error: any) {
        console.warn("Upstox market quote polling warning:", error.response?.data || error.message);
        const errObj = error.response?.data?.errors?.[0];
        const code = errObj?.errorCode || errObj?.error_code;
        const msg = errObj?.message || error.message;

        if (code === 'UDAPI10005' || error.response?.status === 401) {
          this.state.apiError = "Upstox Access Token is invalid or expired (UDAPI10005). Please paste a new token in Settings.";
        } else if (code === 'UDAPI100042' || error.response?.status === 429) {
          isRateLimit = true;
          this.rateLimitBackoffUntil = Date.now() + 6000; // Back off 6 seconds for rate limit
          this.state.apiError = "Upstox API Rate Limit reached (UDAPI100042). Automatically throttling requests...";
        } else if (code) {
          this.state.apiError = `Upstox API Error (${code}): ${msg}`;
        }
      } finally {
        this.isPolling = false;
      }
    } else {
      this.isPolling = false;
    }

    if (!success) {
      if (!isRateLimit) {
        this.handlePollError();
      }
      return;
    }

    // Run strategy engine tick ONLY on live, fresh real-time feed during market hours
        const freshSpot =
      this.state.nifty50.timestamp > 0 &&
      Date.now() - this.state.nifty50.timestamp <= 12_000;

    if (
      
      this.settings.isTradingEnabled &&
      this.state.isConnected &&
      !this.state.apiError &&
      this.strategyEngine.isMarketOpen() &&
      freshSpot
    ) {
      const currentMinuteBucket = Math.floor(Date.now() / 60000) * 60000;
      if (currentMinuteBucket !== this.lastSyncedMinuteBucket) {
        this.lastSyncedMinuteBucket = currentMinuteBucket;
        await this.syncHistoricalCandles();
      }

      const newSignals = await this.strategyEngine.onTick(this.state);
      this.state.signals = newSignals.slice(0, 10);
    } else {
      // If market is closed or trading disabled or feed inactive, exit any active positions
      if (this.strategyEngine.activeSignals.size > 0) {
        const reason = !this.strategyEngine.isMarketOpen() 
          ? "Market Closed (Outside NSE Trading Hours)" 
          : "Market Feed Inactive or Trading Disabled";
        this.strategyEngine.exitAllActiveTrades(reason);
      }
      this.state.signals = [
        ...Array.from(this.strategyEngine.activeSignals.values()),
        ...Array.from(this.strategyEngine.history.values()).reverse()
      ].slice(0, 10) as any[];
    }

    this.state.overallPnL = this.strategyEngine.overallPnL;
    this.state.realizedPnL = this.strategyEngine.realizedPnL;
    this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
    this.state.winRate = this.strategyEngine.winRate;
    this.state.totalTrades = this.strategyEngine.totalTrades;
    this.state.winningTrades = this.strategyEngine.winningTrades;

    this.broadcastState();
  }

  private handlePollError() {
    this.errorCount++;
    this.state.isConnected = false;

    if (this.errorCount >= 3) {
      if (this.strategyEngine.activeSignals.size > 0) {
        console.warn(`Upstox connection lost for ${this.errorCount * 1.5}s. Exiting all active trades.`);
        this.strategyEngine.exitAllActiveTrades("Upstox Connection Lost");
      }
    }

    this.state.overallPnL = this.strategyEngine.overallPnL;
    this.state.realizedPnL = this.strategyEngine.realizedPnL;
    this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
    this.state.winRate = this.strategyEngine.winRate;
    this.state.totalTrades = this.strategyEngine.totalTrades;
    this.state.winningTrades = this.strategyEngine.winningTrades;
    this.broadcastState();
  }

  private recordOptionChainSnapshot(instrumentKey: string, expiryDate: string, rawRows: any[]) {
    const finiteNumber = (value: unknown): number | undefined => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };
    const makeOption = (raw: any) => {
      const md = raw?.market_data || {};
      const greeks = raw?.option_greeks || {};
      return {
        ltp: finiteNumber(md.ltp ?? md.last_price),
        bid: finiteNumber(md.bid_price),
        ask: finiteNumber(md.ask_price),
        totalOi: finiteNumber(md.oi ?? md.total_oi ?? md.totalOi),
        oiChange: finiteNumber(md.oi_change ?? md.oiChange),
        volume: finiteNumber(md.volume),
        iv: finiteNumber(greeks.iv),
        delta: finiteNumber(greeks.delta),
        theta: finiteNumber(greeks.theta),
        gamma: finiteNumber(greeks.gamma),
        vega: finiteNumber(greeks.vega),
        instrumentKey: String(raw?.instrument_key || ''),
      };
    };
    try {
      if (!this.strategyEngine.isMarketOpen()) return;
      if (!rawRows || rawRows.length === 0) return;
      const spot = Number(rawRows[0].underlying_spot_price || 0);
      let totalCallOI = 0;
      let totalPutOI = 0;
      let maxCallOI = -1;
      let maxPutOI = -1;
      let maxCallStrike = 0;
      let maxPutStrike = 0;

      for (const r of rawRows) {
        const coi = Number(
          r.call_options?.market_data?.oi ??
          r.call_options?.market_data?.total_oi ??
          r.call_options?.market_data?.totalOi,
        );
        const poi = Number(
          r.put_options?.market_data?.oi ??
          r.put_options?.market_data?.total_oi ??
          r.put_options?.market_data?.totalOi,
        );

        if (!Number.isFinite(coi) || !Number.isFinite(poi)) {
          return;
        }

        totalCallOI += coi;
        totalPutOI += poi;
        if (coi > maxCallOI) {
          maxCallOI = coi;
          maxCallStrike = r.strike_price;
        }
        if (poi > maxPutOI) {
          maxPutOI = poi;
          maxPutStrike = r.strike_price;
        }
      }

      const pcr = totalCallOI > 0 ? Number((totalPutOI / totalCallOI).toFixed(2)) : 0;
      const nowMs = Date.now();
      
      // Filter last snap for same instrument
      const matchingSnaps = this.optionChainHistory.filter(s => s.instrumentKey === instrumentKey);
      const lastSnap = matchingSnaps[matchingSnaps.length - 1];

      // Enforce 1-minute recording interval (>= 50 seconds apart)
      if (!lastSnap || (nowMs - lastSnap.timestamp >= 50000)) {
        const snap: OptionChainSnapshot = {
          id: `OC_1M_${nowMs}`,
          timestamp: nowMs,
          timeISO: new Date(nowMs).toISOString(),
          instrumentKey,
          expiryDate: expiryDate || 'CURRENT',
          spotPrice: spot,
          totalCallOI,
          totalPutOI,
          pcr,
          maxCallOIStrike: maxCallStrike,
          maxPutOIStrike: maxPutStrike,
          strikeCount: rawRows.length,
          rows: rawRows.map((r: any) => ({
            strike: r.strike_price,
            spot: r.underlying_spot_price,
            ce: makeOption(r.call_options),
            pe: makeOption(r.put_options)
          }))
        };

        this.optionChainHistory.push(snap);
        if (this.optionChainHistory.length > 5000) {
          this.optionChainHistory.shift();
        }

        // Persist to disk asynchronously
        this.saveOptionChainHistoryToDisk();
      }
    } catch (e) {
      console.error("Error recording 1-min option chain snapshot:", e);
    }
  }

  public getOptionChainHistory(): OptionChainSnapshot[] {
    return this.optionChainHistory;
  }

  public clearOptionChainHistory() {
    this.optionChainHistory = [];
    this.saveOptionChainHistoryToDisk();
  }

  private broadcastState() {
    this.broadcast({ type: 'STATE_UPDATE', data: this.state });
  }

  private broadcast(message: any) {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}

