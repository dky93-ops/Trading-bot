import axios from 'axios';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { StrategyEngine } from './strategy-engine.js';
import { InstrumentData, AppState, AppSettings, Signal, OptionChainSnapshot } from './types.js';
import { insertTick } from '../db/market.js';

export class UpstoxService {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private pollingInterval: NodeJS.Timeout | null = null;
  private oneMinRecorderInterval: NodeJS.Timeout | null = null;
  private strategyEngine: StrategyEngine;
  public optionChainHistory: OptionChainSnapshot[] = [];
  private historyFilePath = path.join(process.cwd(), 'data', 'option_chain_history.json');
  
  private settings: AppSettings = {
    apiKey: process.env.UPSTOX_API_KEY || 'b054bae2-c8eb-448e-a9d4-aacd4d355003',
    apiSecret: process.env.UPSTOX_API_SECRET || 'a1mt0adbz8',
    accessToken: process.env.UPSTOX_ACCESS_TOKEN || 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiJDSDQ1ODIiLCJqdGkiOiI2YTNjMGE1ZTU0ZjIyZjBkMzQzYjAwNzciLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzgyMzE5NzEwLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MTM4NzQ0MDB9.hdLqe8bdkWS0zcc4pASjX8nJSJ_WjwbE_diOwGqHQ8Y',
    isTradingEnabled: true, // Global switch
    nifty50Enabled: true,
    expiryDate: 'CURRENT',
    defaultLotsPerTrade: 1,
    maxActiveTrades: 1, // Rule: STRICTLY 1 open trade at a time
    strategies: {
      openingTrap: { enabled: true, lotSize: 1 },
      failedRetest: { enabled: true, lotSize: 1 },
      continuationBreakdown: { enabled: true, lotSize: 1 },
      continuationBreakout: { enabled: true, lotSize: 1 },
      oiWallRejection: { enabled: true, lotSize: 1 },
    }
  };

  private state: AppState = {
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
  private optionChainCache: Record<string, { timestamp: number, data: any }> = {};

  private nearestExpiryCache: Record<string, { date: string, timestamp: number }> = {};

  private async getNearestExpiry(instrumentKey: string): Promise<string> {
    const cached = this.nearestExpiryCache[instrumentKey];
    if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
      return cached.date;
    }
    
    try {
      const response = await axios.get(`https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(instrumentKey)}`, {
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
    if (!this.settings.accessToken) return;

    // Only record during market hours (09:15 to 15:30 IST)
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    if (timeStr < '09:15' || timeStr >= '15:31') {
      return; // Outside market hours
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
      this.getNearestExpiry.bind(this)
    );

    // Load recorded 1-minute option chain history from disk
    this.loadOptionChainHistoryFromDisk();
    
    if (this.settings.accessToken && this.settings.isTradingEnabled) {
      this.startPolling();
    }

    // Always run the 1-minute Option Chain recording loop during server runtime
    this.startOneMinOptionChainRecorder();

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
    this.settings = { ...this.settings, ...newSettings };
    if (newSettings.accessToken) {
      this.state.apiError = undefined;
    }
    this.strategyEngine.updateSettings(this.settings);
    this.broadcast({ type: 'SETTINGS_UPDATE', data: this.settings });
    
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
      const response = await axios.get(`https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(instrumentKey)}`, {
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
              this.state.bankNifty.lastPrice = spot;
              this.state.bankNifty.timestamp = Date.now();
            } else if (instrumentKey.includes('Nifty 50')) {
              this.state.nifty50.lastPrice = spot;
              this.state.nifty50.timestamp = Date.now();
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

  private async fetchOptionData(index: string, type: 'CE' | 'PE', spotPrice: number, strikeOffset: number = 0) {
    try {
      const instrumentKey = index === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank';
      let expiry = this.settings.expiryDate;
      if (!expiry || expiry === 'CURRENT') {
        expiry = await this.getNearestExpiry(instrumentKey);
      }
      const chainResponse = await this.getOptionChain(instrumentKey, expiry);
      if (!chainResponse || !chainResponse.data) return null;
      
      const chainData = chainResponse.data;
      const strikeStep = index === 'NIFTY' ? 50 : 100;
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
        strike: targetStrike
      };
    } catch (error) {
      console.error("Error fetching option data for signal", error);
    }
    return null;
  }

  public startPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    console.log("Starting Upstox Market Data Polling...");
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
            this.state.nifty50 = {
              lastPrice: tick.last_price,
              change: tick.net_change,
              timestamp: Date.now()
            };
            insertTick('NIFTY', tick.last_price, Date.now());
          }
          if (data['NSE_INDEX:India VIX']) {
            const tick = data['NSE_INDEX:India VIX'];
            this.state.indiaVix = {
              lastPrice: tick.last_price,
              change: tick.net_change,
              timestamp: Date.now()
            };
            insertTick('VIX', tick.last_price, Date.now());
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

          // Sync latest prices into state.signals array
          for (const sig of this.state.signals) {
            if (sig.status === 'ACTIVE') {
              const activeSig = this.strategyEngine.activeSignals.get(sig.id);
              if (activeSig && activeSig.latestPrice !== undefined) {
                sig.latestPrice = activeSig.latestPrice;
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
    if (this.settings.isTradingEnabled && this.state.isConnected && !this.state.apiError && this.strategyEngine.isMarketOpen()) {
      const now = Date.now();
      const isNiftyFresh = this.state.nifty50.timestamp > 0 && (now - this.state.nifty50.timestamp < 12000);

      if (isNiftyFresh) {
        const newSignals = await this.strategyEngine.onTick(this.state);
        if (newSignals.length > 0) {
          for (const sig of newSignals) {
            const existingIdx = this.state.signals.findIndex(s => s.id === sig.id);
            if (existingIdx >= 0) {
              this.state.signals[existingIdx] = { ...sig };
            } else {
              this.state.signals.push({ ...sig });
            }
          }
        }
      }
    } else {
      // If market is closed or trading disabled or feed inactive, exit any active positions
      if (this.strategyEngine.activeSignals.size > 0) {
        const reason = !this.strategyEngine.isMarketOpen() 
          ? "Market Closed (Outside NSE Trading Hours)" 
          : "Market Feed Inactive or Trading Disabled";
        this.strategyEngine.exitAllActiveTrades(reason);
      }

      // Mark any remaining active signal in state as CLOSED
      for (const sig of this.state.signals) {
        if (sig.status === 'ACTIVE') {
          sig.status = 'CLOSED';
          sig.exitPrice = sig.latestPrice || sig.entryPrice;
          sig.exitTime = Date.now();
          const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
          const lots = (this.settings.strategies as any)[stratKey]?.lotSize || this.settings.defaultLotsPerTrade || 1;
          sig.realizedPnL = Number(((sig.exitPrice - sig.entryPrice) * 75 * lots).toFixed(2));
        }
      }
    }

    this.updatePnL();
    this.broadcastState();
  }

  private handlePollError() {
    this.errorCount++;
    this.state.isConnected = false;

    // Exit positions after a few seconds (~4.5s = 3 failed polling attempts) of lost connection
    if (this.errorCount >= 3) {
      if (this.strategyEngine.activeSignals.size > 0) {
        console.warn(`Upstox connection lost for ${this.errorCount * 1.5}s. Exiting all active trades due to missing realtime feed.`);
        this.strategyEngine.exitAllActiveTrades("Upstox Connection Lost - Realtime Feed Unavailable");
      }

      for (const sig of this.state.signals) {
        if (sig.status === 'ACTIVE') {
          sig.status = 'CLOSED';
          sig.exitPrice = sig.latestPrice || sig.entryPrice;
          sig.exitTime = Date.now();
          const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
          const lots = (this.settings.strategies as any)[stratKey]?.lotSize || this.settings.defaultLotsPerTrade || 1;
          sig.realizedPnL = Number(((sig.exitPrice - sig.entryPrice) * 75 * lots).toFixed(2));
        }
      }
    }

    this.updatePnL();
    this.broadcastState();
  }

  private updatePnL() {
    const closedTrades = this.state.signals.filter(s => s.status === 'CLOSED');
    const activeTrades = this.state.signals.filter(s => s.status === 'ACTIVE');
    
    this.state.totalTrades = closedTrades.length;
    this.state.winningTrades = closedTrades.filter(s => (s.realizedPnL || 0) > 0).length;
    this.state.winRate = this.state.totalTrades > 0 ? (this.state.winningTrades / this.state.totalTrades) * 100 : 0;

    const realized = closedTrades.reduce((sum, s) => sum + (s.realizedPnL || 0), 0);
    
    let unrealized = 0;
    for (const sig of activeTrades) {
      const curPrice = sig.latestPrice || sig.entryPrice;
      const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
      const lotConfig = (this.settings.strategies as any)[stratKey]?.lotSize || this.settings.defaultLotsPerTrade || 1;
      const qty = 75 * lotConfig;
      unrealized += (curPrice - sig.entryPrice) * qty;
    }

    this.state.realizedPnL = realized;
    this.state.unrealizedPnL = unrealized;
    this.state.overallPnL = realized + unrealized;
  }

  private recordOptionChainSnapshot(instrumentKey: string, expiryDate: string, rawRows: any[]) {
    try {
      if (!rawRows || rawRows.length === 0) return;
      const spot = Number(rawRows[0].underlying_spot_price || 0);
      let totalCallOI = 0;
      let totalPutOI = 0;
      let maxCallOI = -1;
      let maxPutOI = -1;
      let maxCallStrike = 0;
      let maxPutStrike = 0;

      for (const r of rawRows) {
        const coi = r.call_options?.market_data?.oi || 0;
        const poi = r.put_options?.market_data?.oi || 0;
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
            ce: {
              price: r.call_options?.market_data?.ltp || 0,
              oi: r.call_options?.market_data?.oi || 0,
              oiChange: r.call_options?.market_data?.oi_change || 0,
              volume: r.call_options?.market_data?.volume || 0,
              iv: r.call_options?.option_greeks?.iv || 0
            },
            pe: {
              price: r.put_options?.market_data?.ltp || 0,
              oi: r.put_options?.market_data?.oi || 0,
              oiChange: r.put_options?.market_data?.oi_change || 0,
              volume: r.put_options?.market_data?.volume || 0,
              iv: r.put_options?.option_greeks?.iv || 0
            }
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

