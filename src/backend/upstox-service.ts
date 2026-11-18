import axios from 'axios';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { StrategyEngine } from './strategy-engine.js';
import { AppSettings, AppState, OptionChainSnapshot, TradingSymbol, InternalSignal } from './types.js';
import { insertTick, seedHistoricalCandles, getCandles } from '../db/market.js';
import { EnhancedDataManager } from './enhanced-data-manager.js';
import { EnhancedOptionChainRecorder } from './enhanced-option-chain-recorder.js';
import { UpstoxDataFetcher } from './upstox-data-fetcher.js';

export class UpstoxService {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private pollingInterval: NodeJS.Timeout | null = null;
  private oneMinRecorderInterval: NodeJS.Timeout | null = null;
  private strategyEngine: StrategyEngine;
  public optionChainHistory: OptionChainSnapshot[] = [];
  public dataManager: EnhancedDataManager = new EnhancedDataManager();
  public enhancedRecorder: EnhancedOptionChainRecorder = new EnhancedOptionChainRecorder();
  public dataFetcher: UpstoxDataFetcher | null = null;
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
      samSignals: { enabled: true, lotSize: 1 },
      comboFiltered: { enabled: true, lotSize: 1 },
      comboUnfiltered: { enabled: true, lotSize: 1 },
      alphaTrend: { enabled: true, lotSize: 1 },
      t3Striped: { enabled: true, lotSize: 1 },
      macdAdaptiveSupertrend: { enabled: true, lotSize: 1 },
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
  private invalidInstrumentKeys = new Set<string>();

  private isValidUpstoxKey(key: string): boolean {
    if (!key || typeof key !== 'string') return false;
    const trimmed = key.trim();
    const validSegments = ['NSE_INDEX', 'NSE_EQ', 'NSE_FO', 'BSE_INDEX', 'BSE_EQ', 'BSE_FO'];
    const sep = trimmed.includes('|') ? '|' : (trimmed.includes(':') ? ':' : null);
    if (!sep) return false;
    const [seg, id] = trimmed.split(sep);
    return validSegments.includes(seg) && Boolean(id && id.trim().length > 0);
  }

  public generateDefaultExpiries(instrumentKey?: string): string[] {
    const expiries: string[] = [];
    // Compute current date in Indian Standard Time (UTC + 5.5 hours)
    const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
    const todayStr = nowIST.toISOString().split('T')[0];

    let targetDayOfWeek = 4; // Thursday default for NIFTY 50
    const upperKey = (instrumentKey || '').toUpperCase();
    if (upperKey.includes('BANK')) {
      targetDayOfWeek = 3; // Wednesday for BankNifty
    } else if (upperKey.includes('FIN')) {
      targetDayOfWeek = 2; // Tuesday for FinNifty
    } else if (upperKey.includes('MID')) {
      targetDayOfWeek = 1; // Monday for Midcpnifty
    }

    let added = 0;
    for (let offset = 0; offset < 60 && added < 8; offset++) {
      const d = new Date(nowIST.getTime() + offset * 86400000);
      const day = d.getUTCDay();
      const dateStr = d.toISOString().split('T')[0];
      if (day === targetDayOfWeek && dateStr >= todayStr) {
        expiries.push(dateStr);
        added++;
      }
    }

    return expiries.length > 0 ? expiries : [todayStr];
  }


  private nearestExpiryCache: Record<string, { date: string, timestamp: number }> = {};
  private expiriesCache: Record<string, { expiries: string[], timestamp: number }> = {};
  private expiriesInFlight: Map<string, Promise<string[]>> = new Map();
  private optionChainInFlight: Map<string, Promise<any[]>> = new Map();
  private upstoxRateLimitCooldownUntil = 0;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.strategyEngine = new StrategyEngine(
      this.settings, 
      this.state, 
      this.fetchOptionData.bind(this),
      this.getOptionChain.bind(this),
      this.getNearestExpiry.bind(this),
      () => this.getOptionChainHistory()
    );
    
    if (fs.existsSync(this.historyFilePath)) {
      try {
        const data = fs.readFileSync(this.historyFilePath, 'utf8');
        this.optionChainHistory = JSON.parse(data);
      } catch (e) {
        console.error("Failed to load option chain history:", e);
      }
    }
    
    if (this.hasBrokerCredentials()) {
      this.startPolling();
    }

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'STATE_UPDATE', data: this.state }));
      
      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  private saveOptionChainHistoryToDisk() {
    try {
      const dir = path.dirname(this.historyFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.historyFilePath, JSON.stringify(this.optionChainHistory));
    } catch (e) {
      console.error("Failed to save option chain history:", e);
    }
  }

  public updateSettings(newSettings: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    if (this.settings.accessToken && !this.pollingInterval) {
      this.startPolling();
    }
  }

  public getState(): AppState {
    return this.state;
  }

  public resetSignals() {
    this.state.signals = [];
    this.strategyEngine.activeSignals.clear();
    this.state.overallPnL = 0;
    this.state.realizedPnL = 0;
    this.state.unrealizedPnL = 0;
    this.state.winRate = 0;
    this.state.totalTrades = 0;
    this.state.winningTrades = 0;
    this.broadcastState();
  }

  
  public async getExpiries(instrumentKey: string): Promise<string[]> {
    if (!instrumentKey) {
      return this.generateDefaultExpiries('NSE_INDEX|Nifty 50');
    }

    // 1. Check local memory cache (valid for 30 minutes)
    const cached = this.expiriesCache[instrumentKey];
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000 && cached.expiries.length > 0) {
      return cached.expiries;
    }

    // 2. Check if we are currently in 429 rate limit backoff cooldown
    if (Date.now() < this.upstoxRateLimitCooldownUntil) {
      if (cached && cached.expiries.length > 0) return cached.expiries;
      return this.generateDefaultExpiries(instrumentKey);
    }

    // 3. Return existing in-flight request if already pending
    if (this.expiriesInFlight.has(instrumentKey)) {
      return await this.expiriesInFlight.get(instrumentKey)!;
    }

    // 4. If no access token configured, return default scheduled expiries
    if (!this.settings?.accessToken) {
      const defaults = this.generateDefaultExpiries(instrumentKey);
      this.expiriesCache[instrumentKey] = { expiries: defaults, timestamp: Date.now() };
      this.nearestExpiryCache[instrumentKey] = { date: defaults[0], timestamp: Date.now() };
      return defaults;
    }

    // 5. Fetch from Upstox with timeout and safe error handling
    const fetchPromise = (async () => {
      try {
        const response = await axios.get(`https://api.upstox.com/v2/option/contract`, {
          params: { instrument_key: instrumentKey },
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.settings.accessToken}`
          },
          timeout: 5000
        });

        if (response.data && response.data.data && Array.isArray(response.data.data)) {
          const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
          const expirys = [...new Set(response.data.data.map((c: any) => c.expiry))]
            .sort()
            .filter((e: any) => typeof e === 'string' && e >= todayIST) as string[];

          if (expirys.length > 0) {
            this.expiriesCache[instrumentKey] = { expiries: expirys, timestamp: Date.now() };
            this.nearestExpiryCache[instrumentKey] = { date: expirys[0], timestamp: Date.now() };
            return expirys;
          }
        }
      } catch (e: any) {
        const status = e.response?.status;
        const errCode = e.response?.data?.errors?.[0]?.errorCode || e.response?.data?.errors?.[0]?.error_code;
        
        if (status === 429) {
          // Upstox rate limit hit - trigger 60s cooldown to prevent repeated 429 spam
          this.upstoxRateLimitCooldownUntil = Date.now() + 60 * 1000;
          console.warn(`Upstox API 429 rate limit hit for ${instrumentKey}. Backing off for 60s and using scheduled weekly expiries.`);
        } else if (errCode === 'UDAPI1087') {
          this.invalidInstrumentKeys.add(instrumentKey);
          console.warn(`Upstox getExpiries: Invalid instrument key (${instrumentKey})`);
        } else {
          console.warn(`Upstox getExpiries non-critical error: ${e.message}`);
        }
      } finally {
        this.expiriesInFlight.delete(instrumentKey);
      }

      // Safe fallback - NEVER call getNearestExpiry here to avoid cyclic mutual recursion
      const fallback = (cached && cached.expiries.length > 0)
        ? cached.expiries
        : this.generateDefaultExpiries(instrumentKey);

      this.expiriesCache[instrumentKey] = { expiries: fallback, timestamp: Date.now() };
      this.nearestExpiryCache[instrumentKey] = { date: fallback[0], timestamp: Date.now() };
      return fallback;
    })();

    this.expiriesInFlight.set(instrumentKey, fetchPromise);
    return await fetchPromise;
  }

  public async getNearestExpiry(instrumentKey: string): Promise<string> {
    const cached = this.nearestExpiryCache[instrumentKey];
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
      return cached.date;
    }
    
    try {
      const expiries = await this.getExpiries(instrumentKey);
      if (expiries && expiries.length > 0) {
        this.nearestExpiryCache[instrumentKey] = { date: expiries[0], timestamp: Date.now() };
        return expiries[0];
      }
    } catch (error: any) {
      console.warn('Error fetching nearest expiry:', error?.message);
    }
    
    const fallback = this.generateDefaultExpiries(instrumentKey);
    return fallback[0] || 'CURRENT';
  }

  public async getOptionChain(instrumentKey: string, expiryDate?: string): Promise<any[]> {
    let resolvedExpiry = expiryDate || this.settings.expiryDate;
    if (!resolvedExpiry || resolvedExpiry === 'CURRENT') {
      resolvedExpiry = await this.getNearestExpiry(instrumentKey);
    }

    if (!instrumentKey) return [];

    const cacheKey = `${instrumentKey}_${resolvedExpiry}`;
    const cached = this.optionChainCache[cacheKey];

    // Return cached option chain if fresh (< 2500ms) to prevent 429 rate limit from 1.5s frontend polling
    if (cached && Date.now() - cached.timestamp < 2500 && cached.data.length > 0) {
      return cached.data;
    }

    // If in 429 rate limit cooldown, return cached real data if available, otherwise empty array (NEVER synthetic)
    if (Date.now() < this.upstoxRateLimitCooldownUntil) {
      return (cached && cached.data.length > 0) ? cached.data : [];
    }

    // Deduplicate in-flight option chain requests
    if (this.optionChainInFlight.has(cacheKey)) {
      return await this.optionChainInFlight.get(cacheKey)!;
    }

    // If no access token, cannot fetch real broker data - return empty (NEVER synthetic)
    if (!this.settings?.accessToken) {
      return (cached && cached.data.length > 0) ? cached.data : [];
    }

    if (!this.dataFetcher) this.dataFetcher = new UpstoxDataFetcher(this.settings.accessToken, this.dataManager);

    const fetchPromise = (async () => {
      try {
        const rawRows = await this.dataFetcher!.fetchFullOptionChain(instrumentKey, resolvedExpiry);
        if (rawRows && rawRows.length > 0) {
          this.optionChainCache[cacheKey] = { data: rawRows, timestamp: Date.now() };
          // Background record to keep history padded
          this.recordOptionChainSnapshot(instrumentKey, resolvedExpiry, rawRows).catch(e => {
            console.warn("Failed background snapshot record:", e.message);
          });
          return rawRows;
        }
      } catch (e: any) {
        if (e.response?.status === 429) {
          this.upstoxRateLimitCooldownUntil = Date.now() + 60 * 1000;
          console.warn(`Upstox rate limit (429) on option chain [${cacheKey}]. Backing off for 60s.`);
        } else {
          console.warn(`Failed to fetch option chain for ${cacheKey}:`, e.message);
        }
      } finally {
        this.optionChainInFlight.delete(cacheKey);
      }

      // If fetch failed or returned empty, return previously cached real data if available, otherwise empty (NEVER synthetic)
      return (cached && cached.data.length > 0) ? cached.data : [];
    })();

    this.optionChainInFlight.set(cacheKey, fetchPromise);
    return await fetchPromise;
  }

  private async fetchOptionData(spot: number): Promise<OptionChainSnapshot | null> {
    const expiry = await this.getNearestExpiry('NSE_INDEX|Nifty 50');
    const chain = await this.getOptionChain('NSE_INDEX|Nifty 50', expiry);
    if (!chain || chain.length === 0) return null;
    
    // Convert to OptionChainSnapshot
    return {
      id: Date.now().toString(),
      timestamp: Date.now(),
      timeISO: new Date().toISOString(),
      instrumentKey: 'NSE_INDEX|Nifty 50',
      expiryDate: expiry,
      spotPrice: spot,
      totalCallOI: 0,
      totalPutOI: 0,
      pcr: 1,
      maxCallOIStrike: 0,
      maxPutOIStrike: 0,
      strikeCount: chain.length,
      rows: chain.map((c: any) => ({
        strike: c.strike_price,
        ce: c.call_options ? {
          ltp: c.call_options.market_data?.ltp,
          totalOi: c.call_options.market_data?.oi,
          bidPrice: c.call_options.market_data?.bid_price,
          askPrice: c.call_options.market_data?.ask_price,
          volume: c.call_options.market_data?.volume,
          iv: c.call_options.option_greeks?.iv,
          delta: c.call_options.option_greeks?.delta,
          theta: c.call_options.option_greeks?.theta,
          gamma: c.call_options.option_greeks?.gamma,
          vega: c.call_options.option_greeks?.vega,
          oiChange: 0
        } : {} as any,
        pe: c.put_options ? {
          ltp: c.put_options.market_data?.ltp,
          totalOi: c.put_options.market_data?.oi,
          bidPrice: c.put_options.market_data?.bid_price,
          askPrice: c.put_options.market_data?.ask_price,
          volume: c.put_options.market_data?.volume,
          iv: c.put_options.option_greeks?.iv,
          delta: c.put_options.option_greeks?.delta,
          theta: c.put_options.option_greeks?.theta,
          gamma: c.put_options.option_greeks?.gamma,
          vega: c.put_options.option_greeks?.vega,
          oiChange: 0
        } : {} as any
      }))
    };
  }

  private async syncHistoricalCandles() {
    if (!this.settings.accessToken) return;
    if (Date.now() < this.candleSyncBackoffUntil) return;
    try {
      const { ensureNiftyCandles } = await import('../db/market.js');
      await ensureNiftyCandles(this.settings.accessToken);
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
        // Collect active option keys for equity (NIFTY/BANKNIFTY), exclude synthetic or blacklisted keys
        const activeOptionKeys: string[] = [];
        for (const signal of this.strategyEngine.activeSignals.values()) {
          if (signal.instrumentKey) {
            const normKey = signal.instrumentKey.replace(':', '|');
            if (this.isValidUpstoxKey(normKey) && !this.invalidInstrumentKeys.has(normKey)) {
              activeOptionKeys.push(normKey);
            }
          }
        }

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

          if (data['NSE_INDEX:Nifty 50'] || data['NSE_INDEX|Nifty 50']) {
            const tick = data['NSE_INDEX:Nifty 50'] || data['NSE_INDEX|Nifty 50'];
            const niftyLast = Number(tick.last_price);
            const niftyTimestamp = Date.now();
            if (Number.isFinite(niftyLast) && niftyLast > 0) {
              this.state.spotFeedTimestamp = niftyTimestamp;
              this.state.nifty50 = {
                lastPrice: niftyLast,
                change: Number(tick.net_change || 0),
                timestamp: niftyTimestamp,
              };
              if (this.strategyEngine.isMarketOpen()) {
                await insertTick('NIFTY', niftyLast, niftyTimestamp);
              }
            }
          }
          if (data['NSE_INDEX:India VIX'] || data['NSE_INDEX|India VIX']) {
            const tick = data['NSE_INDEX:India VIX'] || data['NSE_INDEX|India VIX'];
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

        if (code === 'UDAPI1087') {
          console.warn(`Upstox UDAPI1087 Invalid Instrument Key detected: ${msg}. Purging and auto-recovering...`);
          // Extract specific invalid instrument key from error message
          const match = msg?.match(/Invalid Instrument key:\s*([^,\s]+)/i);
          if (match && match[1]) {
            const badKey = match[1].trim();
            this.invalidInstrumentKeys.add(badKey);
            this.invalidInstrumentKeys.add(badKey.replace(':', '|'));
            this.invalidInstrumentKeys.add(badKey.replace('|', ':'));
          }

          // Auto-recover immediately with guaranteed core index keys
          try {
            const coreRes = await axios.get(`https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50,NSE_INDEX|India VIX')}`, {
              headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.settings.accessToken}`
              },
              timeout: 4000
            });

            if (coreRes.data?.status === 'success' && coreRes.data.data) {
              const data = coreRes.data.data;
              this.state.isConnected = true;
              this.errorCount = 0;
              this.state.apiError = undefined;
              success = true;

              if (data['NSE_INDEX:Nifty 50'] || data['NSE_INDEX|Nifty 50']) {
                const tick = data['NSE_INDEX:Nifty 50'] || data['NSE_INDEX|Nifty 50'];
                const niftyLast = Number(tick.last_price);
                const niftyTimestamp = Date.now();
                if (Number.isFinite(niftyLast) && niftyLast > 0) {
                  this.state.spotFeedTimestamp = niftyTimestamp;
                  this.state.nifty50 = {
                    lastPrice: niftyLast,
                    change: Number(tick.net_change || 0),
                    timestamp: niftyTimestamp,
                  };
                  if (this.strategyEngine.isMarketOpen()) {
                    await insertTick('NIFTY', niftyLast, niftyTimestamp);
                  }
                }
              }
              if (data['NSE_INDEX:India VIX'] || data['NSE_INDEX|India VIX']) {
                const tick = data['NSE_INDEX:India VIX'] || data['NSE_INDEX|India VIX'];
                this.state.indiaVix = {
                  lastPrice: tick.last_price,
                  change: tick.net_change,
                  timestamp: Date.now()
                };
              }
            }
          } catch (recoveryErr: any) {
            console.error("Core quotes recovery warning:", recoveryErr.message);
          }
        } else if (code === 'UDAPI10005' || error.response?.status === 401) {
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

    // Run strategy engine tick on live, fresh real-time feed during market hours
    const freshSpot = this.state.nifty50.timestamp > 0 && Date.now() - this.state.nifty50.timestamp <= 15_000;
    const isMarketOpen = this.strategyEngine.isMarketOpen();

    if (
      this.settings.isTradingEnabled &&
      this.state.isConnected &&
      !this.state.apiError &&
      isMarketOpen &&
      freshSpot
    ) {
      const currentMinuteBucket = Math.floor(Date.now() / 60000) * 60000;
      if (currentMinuteBucket !== this.lastSyncedMinuteBucket) {
        this.lastSyncedMinuteBucket = currentMinuteBucket;
        await this.syncHistoricalCandles();
        
        // Auto-record option chain snapshot for history/replay buffer
        try {
          const instrument = 'NSE_INDEX|Nifty 50';
          const expiry = await this.getNearestExpiry(instrument);
          if (!this.dataFetcher) this.dataFetcher = new UpstoxDataFetcher(this.settings.accessToken, this.dataManager);
          const rawRows = await this.dataFetcher.fetchFullOptionChain(instrument, expiry);
          if (rawRows && rawRows.length > 0) {
            await this.recordOptionChainSnapshot(instrument, expiry, rawRows);
          }
        } catch (e: any) {
          console.error("Failed to auto-record option chain snapshot:", e.message);
        }
      }

      const newSignals = await this.strategyEngine.onTick(this.state);
      this.state.signals = newSignals.slice(0, 10);
    } else {
      // If market is closed or trading disabled or feed inactive, exit any active positions
      if (this.strategyEngine.activeSignals.size > 0) {
        const reason = !isMarketOpen 
          ? "Market Closed (Outside Trading Hours)" 
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

  private async recordOptionChainSnapshot(instrumentKey: string, expiryDate: string, rawRows: any[]) {
    const nowMs = Date.now();
    let spot = 0;
    for (const r of rawRows) {
      if (r.underlying_spot_price) spot = r.underlying_spot_price;
    }
    this.enhancedRecorder.recordSnapshot(instrumentKey, expiryDate, rawRows, spot, nowMs);
    this.dataFetcher?.recordOptionChainData(rawRows);
    
    const finiteNumber = (value: unknown): number | undefined => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };
    const makeOption = (raw: any) => {
      const md = raw?.market_data || {};
      const greeks = raw?.option_greeks || {};
      return {
        ltp: finiteNumber(md.ltp ?? md.last_price),
        bidPrice: finiteNumber(md.bid_price),
        askPrice: finiteNumber(md.ask_price),
        bidQty: finiteNumber(md.bid_qty),
        askQty: finiteNumber(md.ask_qty),
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
      console.log("[DEBUG] recordOptionChainSnapshot called. isMarketOpen:", this.strategyEngine.isMarketOpen());
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
          r.call_options?.market_data?.totalOi ?? 0
        );
        const poi = Number(
          r.put_options?.market_data?.oi ??
          r.put_options?.market_data?.total_oi ??
          r.put_options?.market_data?.totalOi ?? 0
        );

        if (!Number.isFinite(coi) || !Number.isFinite(poi)) {
          continue;
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
        const indexCandles = await getCandles('NIFTY', 1, 100).catch(() => []);
        
        const ceWalls: any[] = [];
        const peWalls: any[] = [];

        const getOI = (row: any, side: 'CE' | 'PE') => {
          const opt = side === 'CE' ? row?.call_options : row?.put_options;
          const md = opt?.market_data;
          return Number(md?.oi ?? md?.total_oi ?? md?.totalOi ?? 0);
        };

        for (let i = 2; i <= rawRows.length - 3; i++) {
          const r = rawRows[i];
          const strike = r.strike_price;
          
          const ceOI = getOI(r, 'CE');
          const peOI = getOI(r, 'PE');

          const ceSurrounding = [
            getOI(rawRows[i - 2], 'CE'), getOI(rawRows[i - 1], 'CE'),
            getOI(rawRows[i + 1], 'CE'), getOI(rawRows[i + 2], 'CE')
          ];
          const ceAvg = ceSurrounding.reduce((a, b) => a + b, 0) / 4;
          if (ceAvg > 0 && ceOI > ceAvg * 1.5) {
            ceWalls.push({ strike, oi: ceOI, avg: ceAvg, strength: ceOI / ceAvg });
          }

          const peSurrounding = [
            getOI(rawRows[i - 2], 'PE'), getOI(rawRows[i - 1], 'PE'),
            getOI(rawRows[i + 1], 'PE'), getOI(rawRows[i + 2], 'PE')
          ];
          const peAvg = peSurrounding.reduce((a, b) => a + b, 0) / 4;
          if (peAvg > 0 && peOI > peAvg * 1.5) {
            peWalls.push({ strike, oi: peOI, avg: peAvg, strength: peOI / peAvg });
          }
        }

        let atmStrike = 0;
        let minDiff = Infinity;
        for (const r of rawRows) {
          const diff = Math.abs(r.strike_price - spot);
          if (diff < minDiff) {
            minDiff = diff;
            atmStrike = r.strike_price;
          }
        }
        const atmIndex = rawRows.findIndex((r: any) => r.strike_price === atmStrike);
        let filteredRows = rawRows;
        if (atmIndex !== -1) {
          const startIndex = Math.max(0, atmIndex - 12);
          const endIndex = Math.min(rawRows.length - 1, atmIndex + 12);
          filteredRows = rawRows.slice(startIndex, endIndex + 1);
        }

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
          strikeCount: filteredRows.length,
          indexCandles,
          ceWalls,
          peWalls,
          rows: filteredRows.map((r: any) => ({
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

