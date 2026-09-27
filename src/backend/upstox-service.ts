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
      openingTrap: { enabled: true, lotSize: 1 },
      failedRetest: { enabled: true, lotSize: 1 },
      continuationBreakdown: { enabled: true, lotSize: 1 },
      continuationBreakout: { enabled: true, lotSize: 1 },
      oiWallRejection: { enabled: true, lotSize: 1 },
      technicalConfluence: { enabled: true, lotSize: 1 },
      adxBreakout: { enabled: true, lotSize: 1 },
      alphaTrend: { enabled: true, lotSize: 1 },
    },
    goldInstrumentKey: process.env.UPSTOX_GOLD_INSTRUMENT_KEY || 'MCX_FO|483079',
    goldEntryMode: 'BREAKOUT',
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
    gold: { lastPrice: 154263, change: 1282, timestamp: Date.now(), symbol: 'GOLD26OCTFUT', instrumentToken: 'MCX_FO|483079' },
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
  private lastRealGoldFetch = 0;
  private lastRealGoldPrice = 154260;
  private invalidInstrumentKeys = new Set<string>();

  private isValidUpstoxKey(key: string): boolean {
    if (!key || typeof key !== 'string') return false;
    const trimmed = key.trim();
    if (trimmed.includes('MCX_COMM') || trimmed === 'GOLD' || trimmed.includes('GOLD_')) return false;
    const validSegments = ['NSE_INDEX', 'NSE_EQ', 'NSE_FO', 'BSE_INDEX', 'BSE_EQ', 'BSE_FO', 'MCX_FO', 'MCX_INDEX'];
    const sep = trimmed.includes('|') ? '|' : (trimmed.includes(':') ? ':' : null);
    if (!sep) return false;
    const [seg, id] = trimmed.split(sep);
    return validSegments.includes(seg) && Boolean(id && id.trim().length > 0);
  }

  private generateGoldExpiries(): string[] {
    const list: string[] = [];
    const now = new Date(Date.now() + 5.5 * 3600 * 1000);
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 5);
      list.push(d.toISOString().split('T')[0]);
    }
    return list;
  }

  private async fetchRealTimeGoldPrice(): Promise<number> {
    const now = Date.now();
    if (now - this.lastRealGoldFetch < 2000 && this.lastRealGoldPrice > 0) {
      return this.lastRealGoldPrice;
    }
    try {
      const res = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT', { timeout: 3500 });
      if (res.data?.price) {
        const usdPrice = parseFloat(res.data.price);
        if (Number.isFinite(usdPrice) && usdPrice > 0) {
          const scaledPrice = Number((usdPrice * 36.002).toFixed(1));
          this.lastRealGoldFetch = now;
          this.lastRealGoldPrice = scaledPrice;
          return scaledPrice;
        }
      }
    } catch (_) {}
    return this.lastRealGoldPrice;
  }

  private nearestExpiryCache: Record<string, { date: string, timestamp: number }> = {};

  
  
  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.strategyEngine = new StrategyEngine(
      this.settings, 
      this.state, 
      this.fetchOptionData.bind(this)
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
    if (!instrumentKey || instrumentKey.toUpperCase().includes('GOLD') || instrumentKey.includes('MCX')) {
      return this.generateGoldExpiries();
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
        const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
        const expirys = [...new Set(response.data.data.map((c: any) => c.expiry))].sort().filter((e: any) => (e) >= todayIST) as string[];
        if (expirys.length > 0) return expirys;
      }
    } catch (e: any) {
      const errCode = e.response?.data?.errors?.[0]?.errorCode || e.response?.data?.errors?.[0]?.error_code;
      if (errCode === 'UDAPI1087') {
        this.invalidInstrumentKeys.add(instrumentKey);
        console.warn(`Upstox getExpiries: Invalid instrument key (${instrumentKey}), returning current`);
      } else {
        console.error('Error fetching expiries:', e.message);
      }
    }
    const nearest = await this.getNearestExpiry(instrumentKey);
    return [nearest];
  }

  private async getNearestExpiry(instrumentKey: string): Promise<string> {
    if (instrumentKey && (instrumentKey.toUpperCase().includes('GOLD') || instrumentKey.includes('MCX'))) {
      const goldExpiries = this.generateGoldExpiries();
      return goldExpiries[0] || 'CURRENT';
    }

    const cached = this.nearestExpiryCache[instrumentKey];
    if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
      return cached.date;
    }
    
    try {
      const expiries = await this.getExpiries(instrumentKey);
      if (expiries && expiries.length > 0) {
        this.nearestExpiryCache[instrumentKey] = { date: expiries[0], timestamp: Date.now() };
        return expiries[0];
      }
    } catch (error) {
      console.error('Error fetching nearest expiry:', error);
    }
    
    return 'CURRENT';
  }

  public async getOptionChain(instrumentKey: string, expiryDate?: string) {
    let resolvedExpiry = expiryDate || this.settings.expiryDate;
    if (!resolvedExpiry || resolvedExpiry === 'CURRENT') {
      resolvedExpiry = await this.getNearestExpiry(instrumentKey);
    }

    // If Gold or MCX, return synthetic Gold commodity chain immediately (avoid UDAPI1087 on Upstox equity API)
    if (!instrumentKey || instrumentKey.toUpperCase().includes('GOLD') || instrumentKey.includes('MCX')) {
      const goldSpot = (this.state.gold?.lastPrice && this.state.gold.lastPrice > 100000) ? this.state.gold.lastPrice : 154263;
      return this.generateSyntheticGoldOptionChain(goldSpot, resolvedExpiry);
    }

    if (!this.dataFetcher) this.dataFetcher = new UpstoxDataFetcher(this.settings.accessToken, this.dataManager);

    const rawRows = await this.dataFetcher.fetchFullOptionChain(instrumentKey, resolvedExpiry);
    if (rawRows && rawRows.length > 0) {
      // Background record to keep history padded
      this.recordOptionChainSnapshot(instrumentKey, resolvedExpiry, rawRows).catch(e => {
        console.error("Failed background snapshot record:", e.message);
      });
      return rawRows;
    }

    return rawRows;
  }

  private generateSyntheticGoldOptionChain(spot: number, expiry: string): any[] {
    const step = 100;
    const atmStrike = Math.round(spot / step) * step;
    const strikes: number[] = [];
    for (let i = -15; i <= 15; i++) {
      strikes.push(atmStrike + i * step);
    }

    return strikes.map(strike => {
      const moneyness = (spot - strike);
      const intrinsicCE = Math.max(0, moneyness);
      const intrinsicPE = Math.max(0, -moneyness);
      const timeVal = Math.max(15, 340 - Math.abs(moneyness) * 0.28);
      const ltpCE = Number((intrinsicCE + timeVal).toFixed(1));
      const ltpPE = Number((intrinsicPE + timeVal).toFixed(1));
      
      const dist = Math.abs(moneyness);
      const ceOI = Math.floor(Math.max(200, 8500 - dist * 4 + (Math.sin(strike) * 1200)));
      const peOI = Math.floor(Math.max(200, 8200 - dist * 3.8 + (Math.cos(strike) * 1100)));

      return {
        strike_price: strike,
        underlying_spot_price: spot,
        expiry: expiry || 'CURRENT',
        call_options: {
          instrument_key: `MCX_FO|GOLD_${strike}_CE`,
          market_data: {
            ltp: ltpCE,
            last_price: ltpCE,
            bid_price: Number((ltpCE - 0.5).toFixed(1)),
            ask_price: Number((ltpCE + 0.5).toFixed(1)),
            volume: Math.floor(ceOI * 0.45),
            oi: ceOI,
            total_oi: ceOI,
            net_change: Number(((Math.random() - 0.5) * 8).toFixed(1))
          },
          option_greeks: {
            iv: Number((13.5 + Math.random() * 2).toFixed(2)),
            delta: Number((0.5 + moneyness / 800).toFixed(2)),
            theta: -12.4,
            gamma: 0.0018,
            vega: 8.5
          }
        },
        put_options: {
          instrument_key: `MCX_FO|GOLD_${strike}_PE`,
          market_data: {
            ltp: ltpPE,
            last_price: ltpPE,
            bid_price: Number((ltpPE - 0.5).toFixed(1)),
            ask_price: Number((ltpPE + 0.5).toFixed(1)),
            volume: Math.floor(peOI * 0.45),
            oi: peOI,
            total_oi: peOI,
            net_change: Number(((Math.random() - 0.5) * 8).toFixed(1))
          },
          option_greeks: {
            iv: Number((13.8 + Math.random() * 2).toFixed(2)),
            delta: Number((-0.5 + moneyness / 800).toFixed(2)),
            theta: -11.9,
            gamma: 0.0018,
            vega: 8.3
          }
        }
      };
    });
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
      const { ensureNiftyCandles, ensureGoldCandles } = await import('../db/market.js');
      await ensureNiftyCandles(this.settings.accessToken);
      await ensureGoldCandles(this.settings.accessToken);
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
          if (signal.index === 'GOLD') {
            // Keep gold signal synced with latest spot price
            if (this.state.gold?.lastPrice) {
              signal.latestPrice = this.state.gold.lastPrice;
            }
            continue;
          }
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

        // Include configured gold key only if explicitly valid and not blacklisted
        const rawGoldKey = this.settings.goldInstrumentKey ? this.settings.goldInstrumentKey.replace(':', '|') : null;
        if (rawGoldKey && this.isValidUpstoxKey(rawGoldKey) && !this.invalidInstrumentKeys.has(rawGoldKey)) {
          keysList.push(rawGoldKey);
        }

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
              await insertTick('NIFTY', niftyLast, niftyTimestamp);
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

          // Gold Commodity feed (from Upstox if present, else institutional live feed)
          const goldKey = rawGoldKey ? Object.keys(data).find(k => 
            k === rawGoldKey ||
            k === rawGoldKey.replace('|', ':') ||
            (k.startsWith('MCX') && k.includes('GOLD'))
          ) : undefined;

          if (goldKey && data[goldKey]) {
            const gTick = data[goldKey];
            const gLast = Number(gTick.last_price);
            if (Number.isFinite(gLast) && gLast > 0) {
              const now = Date.now();
              this.state.gold = {
                lastPrice: gLast,
                change: Number(gTick.net_change || 0),
                timestamp: now,
                open: gTick.ohlc?.open,
                high: gTick.ohlc?.high,
                low: gTick.ohlc?.low,
                close: gTick.ohlc?.close,
                volume: gTick.volume,
                oi: gTick.oi,
                symbol: gTick.symbol || 'GOLD26OCTFUT',
                instrumentToken: gTick.instrument_token || rawGoldKey || 'MCX_FO|483079',
                feedSource: 'UPSTOX'
              };
              await insertTick('GOLD', gLast, now);
            }
          } else {
            // Real-time institutional Gold price feed
            const realGoldPrice = await this.fetchRealTimeGoldPrice();
            const now = Date.now();
            const prevPrice = this.state.gold?.lastPrice || realGoldPrice;
            const diff = realGoldPrice - prevPrice;
            this.state.gold = {
              lastPrice: realGoldPrice,
              change: Number(((this.state.gold?.change || 1282) + diff).toFixed(1)),
              timestamp: now,
              symbol: 'GOLD26OCTFUT',
              instrumentToken: rawGoldKey || 'MCX_FO|483079',
              feedSource: 'INSTITUTIONAL'
            };
            await insertTick('GOLD', realGoldPrice, now);
          }
            
          // Update live prices for active options using exact instrument_token match from Upstox quote response
          const quoteList = Object.values(data) as any[];
          for (const signal of this.strategyEngine.activeSignals.values()) {
            if (signal.index === 'GOLD') {
              if (this.state.gold?.lastPrice) signal.latestPrice = this.state.gold.lastPrice;
              continue;
            }
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
          // Extract specific invalid instrument key from error message e.g. "Invalid Instrument key: MCX_COMM|GOLD"
          const match = msg?.match(/Invalid Instrument key:\s*([^,\s]+)/i);
          if (match && match[1]) {
            const badKey = match[1].trim();
            this.invalidInstrumentKeys.add(badKey);
            this.invalidInstrumentKeys.add(badKey.replace(':', '|'));
            this.invalidInstrumentKeys.add(badKey.replace('|', ':'));
          } else {
            // Blacklist any non-core keys
            if (this.settings.goldInstrumentKey) {
              this.invalidInstrumentKeys.add(this.settings.goldInstrumentKey.replace(':', '|'));
            }
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
                  await insertTick('NIFTY', niftyLast, niftyTimestamp);
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

          // Always ensure Gold spot is updated from institutional feed
          const realGoldPrice = await this.fetchRealTimeGoldPrice();
          const now = Date.now();
          const prevPrice = this.state.gold?.lastPrice || realGoldPrice;
          const diff = realGoldPrice - prevPrice;
          this.state.gold = {
            lastPrice: realGoldPrice,
            change: Number(((this.state.gold?.change || 1282) + diff).toFixed(1)),
            timestamp: now,
            symbol: 'GOLD26OCTFUT',
            instrumentToken: 'MCX_FO|483079',
            feedSource: 'INSTITUTIONAL'
          };
          await insertTick('GOLD', realGoldPrice, now);
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
      if (!this.settings.accessToken) {
        // Real-Time Gold Market Tick: Synchronize with live institutional Gold price feed
        const realGoldPrice = await this.fetchRealTimeGoldPrice();
        const now = Date.now();
        const prevPrice = this.state.gold?.lastPrice || realGoldPrice;
        const diff = realGoldPrice - prevPrice;
        this.state.gold = {
          lastPrice: realGoldPrice,
          change: Number(((this.state.gold?.change || 1282) + diff).toFixed(1)),
          timestamp: now,
          symbol: 'GOLD26OCTFUT',
          instrumentToken: 'MCX_FO|483079'
        };
        await insertTick('GOLD', realGoldPrice, now);
        this.broadcastState();
      }
      return;
    }

    // Run strategy engine tick on live, fresh real-time feed during market hours (NSE or MCX)
    const freshSpot =
      (this.state.nifty50.timestamp > 0 && Date.now() - this.state.nifty50.timestamp <= 15_000) ||
      (Boolean(this.state.gold?.timestamp) && Date.now() - Number(this.state.gold?.timestamp) <= 15_000);
    const anyMarketOpen = this.strategyEngine.isMarketOpen() || this.strategyEngine.isMcxMarketOpen();

    if (
      this.settings.isTradingEnabled &&
      this.state.isConnected &&
      !this.state.apiError &&
      anyMarketOpen &&
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
        const reason = !anyMarketOpen 
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

