import axios from 'axios';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { OptionChainSnapshot } from './types.js';
import {
  NIFTY_LOT_SIZE,
  IST_OFFSET_SEC,
  CompactStrikeQuote,
  CompactOptionSnapshot,
  TradeOptionInput,
  ResolvedTradeOptionData,
  OptionCandleBar,
  isPositiveFinite,
  toIstDateKey,
  round2,
  resolveTradeFromSnapshots,
  resolveTradeFromOptionCandles,
} from '../lib/option-premium-utils.js';

export {
  NIFTY_LOT_SIZE,
  IST_OFFSET_SEC,
  resolveTradeFromSnapshots,
  resolveTradeFromOptionCandles,
};
export type {
  CompactStrikeQuote,
  CompactOptionSnapshot,
  TradeOptionInput,
  ResolvedTradeOptionData,
  OptionCandleBar,
};

interface OptionContractInfo {
  instrumentKey: string;
  expiry: string;
  strike: number;
  optType: 'CE' | 'PE';
  isExpired: boolean;
  delta?: number;
  ltp?: number;
}

/**
 * Builds compact option chain snapshots preserving ALL recorded strikes per snapshot
 * so entry & exit lookups match the exact traded strike even when Nifty spot moves.
 */
export function buildCompactOptionSnapshots(
  history: OptionChainSnapshot[]
): CompactOptionSnapshot[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  const result: CompactOptionSnapshot[] = [];

  for (const s of history) {
    const t = Number((s as any)?.timestamp);
    if (!Number.isFinite(t) || t <= 0) continue;

    const spot = Number((s as any)?.spotPrice || 0);
    const atm = spot > 0 ? Math.round(spot / 50) * 50 : 0;
    const strikes: Record<number, CompactStrikeQuote> = {};
    const rows = Array.isArray((s as any)?.rows) ? (s as any).rows : [];

    for (const r of rows) {
      const strike = Number(r?.strike ?? r?.strike_price);
      if (!Number.isFinite(strike) || strike <= 0) continue;

      const ceLtpRaw = Number(r?.ce?.ltp);
      const peLtpRaw = Number(r?.pe?.ltp);
      const ceDeltaRaw = Number(r?.ce?.delta);
      const peDeltaRaw = Number(r?.pe?.delta);

      const quote: CompactStrikeQuote = {};
      if (Number.isFinite(ceLtpRaw) && ceLtpRaw > 0) quote.ce = round2(ceLtpRaw);
      if (Number.isFinite(peLtpRaw) && peLtpRaw > 0) quote.pe = round2(peLtpRaw);
      if (Number.isFinite(ceDeltaRaw) && ceDeltaRaw !== 0) quote.ceD = Number(ceDeltaRaw.toFixed(4));
      if (Number.isFinite(peDeltaRaw) && peDeltaRaw !== 0) quote.peD = Number(peDeltaRaw.toFixed(4));

      if (quote.ce !== undefined || quote.pe !== undefined) {
        strikes[strike] = quote;
      }
    }

    const atmQuote = strikes[atm];
    result.push({
      t,
      spot,
      atm,
      expiry: (s as any)?.expiryDate || undefined,
      ceLtp: atmQuote?.ce ?? null,
      peLtp: atmQuote?.pe ?? null,
      ceDelta: atmQuote?.ceD ?? null,
      peDelta: atmQuote?.peD ?? null,
      strikes,
    });
  }

  result.sort((a, b) => a.t - b.t);
  return result;
}

export class OptionPremiumResolver {
  private getHistory: () => OptionChainSnapshot[];
  private getAccessToken: () => string;
  private getActiveExpiries: (instrumentKey: string) => Promise<string[]>;
  private getActiveOptionChain: (instrumentKey: string, expiryDate?: string) => Promise<any[]>;

  private activeExpiriesCache: { list: string[]; fetchedAt: number } | null = null;
  private expiredExpiriesCache: { list: string[]; fetchedAt: number } | null = null;
  private activeContractsCache: { map: Map<string, OptionContractInfo>; fetchedAt: number } | null = null;
  private expiredContractsByExpiry = new Map<string, Map<string, OptionContractInfo>>();
  private optionCandlesCache = new Map<string, { bars: OptionCandleBar[]; fetchedAt: number; toDate: string; fromDate: string }>();
  private inFlightCandleFetches = new Map<string, Promise<OptionCandleBar[]>>();
  private inFlightBackfill: Promise<{
    extractedDays: string[];
    skippedDays: string[];
    snapshotsCreated: number;
  }> | null = null;
  private cacheFilePath = path.join(process.cwd(), 'data', 'option_candles_cache.json');
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(deps: {
    getHistory: () => OptionChainSnapshot[];
    getAccessToken: () => string;
    getActiveExpiries: (instrumentKey: string) => Promise<string[]>;
    getActiveOptionChain: (instrumentKey: string, expiryDate?: string) => Promise<any[]>;
  }) {
    this.getHistory = deps.getHistory;
    this.getAccessToken = deps.getAccessToken;
    this.getActiveExpiries = deps.getActiveExpiries;
    this.getActiveOptionChain = deps.getActiveOptionChain;
    this.loadDiskCache();
  }

  private loadDiskCache() {
    try {
      if (!fs.existsSync(this.cacheFilePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        for (const [key, entry] of Object.entries<any>(raw)) {
          if (entry && Array.isArray(entry.bars) && entry.bars.length > 0) {
            this.optionCandlesCache.set(key, {
              bars: entry.bars,
              fetchedAt: Number(entry.fetchedAt) || Date.now(),
              toDate: String(entry.toDate || ''),
              fromDate: String(entry.fromDate || ''),
            });
          }
        }
      }
    } catch (e: any) {
      console.warn('[OptionPremiumResolver] Failed to load disk cache:', e.message);
    }
  }

  private scheduleDiskCacheSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const dir = path.dirname(this.cacheFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const entries = Array.from(this.optionCandlesCache.entries())
          .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
          .slice(0, 120);
        const obj: Record<string, any> = {};
        for (const [k, v] of entries) {
          obj[k] = v;
        }
        fs.writeFileSync(this.cacheFilePath, JSON.stringify(obj));
      } catch (e: any) {
        console.warn('[OptionPremiumResolver] Failed to save disk cache:', e.message);
      }
    }, 1500);
  }

  private getAuthHeaders(): Record<string, string> {
    const token = this.getAccessToken();
    return token
      ? { Accept: 'application/json', Authorization: `Bearer ${token}` }
      : { Accept: 'application/json' };
  }

  private async getAllKnownExpiries(): Promise<{ active: string[]; expired: string[] }> {
    const now = Date.now();
    const sixHours = 6 * 3600_000;

    if (!this.activeExpiriesCache || now - this.activeExpiriesCache.fetchedAt > sixHours) {
      try {
        const list = await this.getActiveExpiries('NSE_INDEX|Nifty 50');
        if (Array.isArray(list) && list.length > 0) {
          this.activeExpiriesCache = { list: [...list].sort(), fetchedAt: now };
        }
      } catch (e: any) {
        console.warn('[OptionPremiumResolver] Active expiries fetch failed:', e.message);
      }
    }

    if (!this.expiredExpiriesCache || now - this.expiredExpiriesCache.fetchedAt > sixHours) {
      const token = this.getAccessToken();
      if (token) {
        try {
          const resp = await axios.get(
            `https://api.upstox.com/v2/expired-instruments/expiries?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}`,
            { headers: this.getAuthHeaders(), timeout: 8000 }
          );
          const list = Array.isArray(resp.data?.data) ? [...resp.data.data].sort() : [];
          if (list.length > 0) {
            this.expiredExpiriesCache = { list, fetchedAt: now };
          }
        } catch (e: any) {
          console.warn('[OptionPremiumResolver] Expired expiries fetch failed:', e.response?.status || e.message);
        }
      }
    }

    return {
      active: this.activeExpiriesCache?.list || [],
      expired: this.expiredExpiriesCache?.list || [],
    };
  }

  private async resolveExpiryForDate(istDateKey: string): Promise<{ expiry: string; isExpired: boolean } | null> {
    const { active, expired } = await this.getAllKnownExpiries();
    const todayIst = toIstDateKey(Date.now());

    const all = Array.from(new Set([...expired, ...active])).sort();
    const match = all.find(exp => exp >= istDateKey);
    if (!match) return null;

    const isExpired = expired.includes(match) && !active.includes(match)
      ? true
      : match < todayIst;

    return { expiry: match, isExpired };
  }

  private async getActiveContractsMap(): Promise<Map<string, OptionContractInfo>> {
    const now = Date.now();
    if (this.activeContractsCache && now - this.activeContractsCache.fetchedAt < 6 * 3600_000) {
      return this.activeContractsCache.map;
    }

    const map = new Map<string, OptionContractInfo>();

    try {
      const { active } = await this.getAllKnownExpiries();
      const nearestExpiry = active[0];
      if (nearestExpiry) {
        const chain = await this.getActiveOptionChain('NSE_INDEX|Nifty 50', nearestExpiry);
        for (const r of chain || []) {
          const strike = Number(r?.strike_price);
          if (!Number.isFinite(strike)) continue;
          if (r?.call_options?.instrument_key) {
            map.set(`${nearestExpiry}_${strike}_CE`, {
              instrumentKey: String(r.call_options.instrument_key),
              expiry: nearestExpiry,
              strike,
              optType: 'CE',
              isExpired: false,
              delta: Number(r.call_options.option_greeks?.delta) || undefined,
              ltp: Number(r.call_options.market_data?.ltp) || undefined,
            });
          }
          if (r?.put_options?.instrument_key) {
            map.set(`${nearestExpiry}_${strike}_PE`, {
              instrumentKey: String(r.put_options.instrument_key),
              expiry: nearestExpiry,
              strike,
              optType: 'PE',
              isExpired: false,
              delta: Number(r.put_options.option_greeks?.delta) || undefined,
              ltp: Number(r.put_options.market_data?.ltp) || undefined,
            });
          }
        }
      }
    } catch (e: any) {
      console.warn('[OptionPremiumResolver] Live chain contract load warning:', e.message);
    }

    try {
      const res = await axios.get('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      const buf = await new Promise<Buffer>((resolve, reject) => {
        zlib.gunzip(res.data, (err, b) => (err ? reject(err) : resolve(b)));
      });
      const list = JSON.parse(buf.toString('utf-8'));
      for (const item of list) {
        if (item?.name !== 'NIFTY') continue;
        if (item?.instrument_type !== 'CE' && item?.instrument_type !== 'PE') continue;
        if (!item?.expiry || !item?.strike_price || !item?.instrument_key) continue;
        const expDate = toIstDateKey(Number(item.expiry));
        const strike = Number(item.strike_price);
        const optType = item.instrument_type as 'CE' | 'PE';
        const k = `${expDate}_${strike}_${optType}`;
        if (!map.has(k)) {
          map.set(k, {
            instrumentKey: String(item.instrument_key),
            expiry: expDate,
            strike,
            optType,
            isExpired: false,
          });
        }
      }
    } catch (e: any) {
      console.warn('[OptionPremiumResolver] NSE.json.gz contract load warning:', e.message);
    }

    if (map.size > 0) {
      this.activeContractsCache = { map, fetchedAt: now };
    }
    return map;
  }

  private async getExpiredContractsForExpiry(expiry: string): Promise<Map<string, OptionContractInfo>> {
    const existing = this.expiredContractsByExpiry.get(expiry);
    if (existing) return existing;

    const map = new Map<string, OptionContractInfo>();
    const token = this.getAccessToken();
    if (!token) return map;

    try {
      const resp = await axios.get(
        `https://api.upstox.com/v2/expired-instruments/option/contract?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}&expiry_date=${encodeURIComponent(expiry)}`,
        { headers: this.getAuthHeaders(), timeout: 10000 }
      );
      const rows = Array.isArray(resp.data?.data) ? resp.data.data : [];
      for (const item of rows) {
        const strike = Number(item?.strike_price);
        const optType = item?.instrument_type;
        if (!Number.isFinite(strike) || (optType !== 'CE' && optType !== 'PE') || !item?.instrument_key) {
          continue;
        }
        map.set(`${expiry}_${strike}_${optType}`, {
          instrumentKey: String(item.instrument_key),
          expiry,
          strike,
          optType,
          isExpired: true,
        });
      }
      if (map.size > 0) {
        this.expiredContractsByExpiry.set(expiry, map);
      }
    } catch (e: any) {
      console.warn(`[OptionPremiumResolver] Expired contracts fetch failed for ${expiry}:`, e.response?.status || e.message);
    }

    return map;
  }

  private async findContract(
    expiry: string,
    isExpired: boolean,
    strike: number,
    optType: 'CE' | 'PE'
  ): Promise<OptionContractInfo | null> {
    const key = `${expiry}_${strike}_${optType}`;
    if (!isExpired) {
      const activeMap = await this.getActiveContractsMap();
      const found = activeMap.get(key);
      if (found) return found;
    }
    const expMap = await this.getExpiredContractsForExpiry(expiry);
    return expMap.get(key) || null;
  }

  private async fetchOption1mCandles(
    contract: OptionContractInfo,
    fromDate: string,
    toDate: string
  ): Promise<OptionCandleBar[]> {
    const cacheKey = `${contract.instrumentKey}|${contract.isExpired ? 'EXP' : 'ACT'}`;
    const todayIst = toIstDateKey(Date.now());
    const needsToday = toDate >= todayIst;
    const cached = this.optionCandlesCache.get(cacheKey);

    if (cached) {
      const coversRange = cached.fromDate <= fromDate && cached.toDate >= toDate;
      const isFreshEnough = !needsToday || Date.now() - cached.fetchedAt < 45_000;
      if (coversRange && isFreshEnough) {
        return cached.bars;
      }
    }

    const inFlightKey = `${cacheKey}|${fromDate}|${toDate}`;
    if (this.inFlightCandleFetches.has(inFlightKey)) {
      return this.inFlightCandleFetches.get(inFlightKey)!;
    }

    const promise = (async (): Promise<OptionCandleBar[]> => {
      const headers = this.getAuthHeaders();
      const encodedKey = encodeURIComponent(contract.instrumentKey);
      const merged = new Map<number, OptionCandleBar>();

      if (cached) {
        for (const b of cached.bars) merged.set(b.t, b);
      }

      const ingestRaw = (rawList: any[]) => {
        for (const c of rawList || []) {
          const tMs = new Date(c[0]).getTime();
          const o = Number(c[1]);
          const h = Number(c[2]);
          const l = Number(c[3]);
          const close = Number(c[4]);
          const vol = Number(c[5]);
          const oi = Number(c[6]);
          if (!Number.isFinite(tMs) || !isPositiveFinite(close)) continue;
          const minuteKey = Math.floor(tMs / 60_000) * 60_000;
          merged.set(minuteKey, {
            t: minuteKey,
            o: isPositiveFinite(o) ? o : close,
            h: isPositiveFinite(h) ? h : close,
            l: isPositiveFinite(l) ? l : close,
            c: close,
            v: Number.isFinite(vol) && vol >= 0 ? vol : undefined,
            oi: Number.isFinite(oi) && oi >= 0 ? oi : undefined,
          });
        }
      };

      if (contract.isExpired) {
        try {
          const resp = await axios.get(
            `https://api.upstox.com/v2/expired-instruments/historical-candle/${encodedKey}/1minute/${toDate}/${fromDate}`,
            { headers, timeout: 10000 }
          );
          ingestRaw(resp.data?.data?.candles || []);
        } catch (e: any) {
          console.warn(
            `[OptionPremiumResolver] Expired option candle fetch failed (${contract.strike}${contract.optType} ${contract.expiry}):`,
            e.response?.status || e.message
          );
        }
      } else {
        try {
          const histResp = await axios.get(
            `https://api.upstox.com/v2/historical-candle/${encodedKey}/1minute/${toDate}/${fromDate}`,
            { headers, timeout: 10000 }
          );
          ingestRaw(histResp.data?.data?.candles || []);
        } catch (e: any) {
          console.warn(
            `[OptionPremiumResolver] Active option hist candle fetch failed (${contract.strike}${contract.optType} ${contract.expiry}):`,
            e.response?.status || e.message
          );
        }

        if (needsToday) {
          try {
            const intraResp = await axios.get(
              `https://api.upstox.com/v3/historical-candle/intraday/${encodedKey}/minutes/1`,
              { headers, timeout: 10000 }
            );
            ingestRaw(intraResp.data?.data?.candles || []);
          } catch (e: any) {
            console.warn(
              `[OptionPremiumResolver] Active option intraday candle fetch failed (${contract.strike}${contract.optType} ${contract.expiry}):`,
              e.response?.status || e.message
            );
          }
        }
      }

      const bars = Array.from(merged.values()).sort((a, b) => a.t - b.t);
      if (bars.length > 0) {
        const nextFrom = cached && cached.fromDate < fromDate ? cached.fromDate : fromDate;
        const nextTo = cached && cached.toDate > toDate ? cached.toDate : toDate;
        this.optionCandlesCache.set(cacheKey, {
          bars,
          fetchedAt: Date.now(),
          fromDate: nextFrom,
          toDate: nextTo,
        });
        this.scheduleDiskCacheSave();
      }
      return bars;
    })();

    this.inFlightCandleFetches.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlightCandleFetches.delete(inFlightKey);
    }
  }

  public async resolveTrades(
    trades: TradeOptionInput[],
    defaultTimeframeMin: number = 1
  ): Promise<Record<string, ResolvedTradeOptionData>> {
    const resolved: Record<string, ResolvedTradeOptionData> = {};
    if (!Array.isArray(trades) || trades.length === 0) return resolved;

    const snapshots = buildCompactOptionSnapshots(this.getHistory());
    const unresolved: TradeOptionInput[] = [];

    for (const rawTrade of trades) {
      const t: TradeOptionInput = {
        ...rawTrade,
        timeframeMin: rawTrade.timeframeMin || defaultTimeframeMin,
      };
      const fromHistory = resolveTradeFromSnapshots(t, snapshots, NIFTY_LOT_SIZE);
      if (fromHistory.optionDataSource === 'OPTION_CHAIN_HISTORY') {
        resolved[t.id] = fromHistory;
      } else {
        resolved[t.id] = fromHistory;
        unresolved.push(t);
      }
    }

    if (unresolved.length === 0) return resolved;

    interface ContractGroup {
      expiry: string;
      isExpired: boolean;
      strike: number;
      optType: 'CE' | 'PE';
      minDate: string;
      maxDate: string;
      trades: TradeOptionInput[];
    }

    const groups = new Map<string, ContractGroup>();

    for (const t of unresolved) {
      const entryUtcMs = (t.entryTime - IST_OFFSET_SEC) * 1000;
      const entryDate = toIstDateKey(entryUtcMs);
      const exitDate = t.exitTime ? toIstDateKey((t.exitTime - IST_OFFSET_SEC) * 1000) : entryDate;
      const expiryInfo = await this.resolveExpiryForDate(entryDate);
      if (!expiryInfo) continue;

      const strike = Math.round(t.entryPrice / 50) * 50;
      const optType: 'CE' | 'PE' = t.type === 'LONG' ? 'CE' : 'PE';
      const gKey = `${expiryInfo.expiry}_${strike}_${optType}`;

      const existing = groups.get(gKey);
      if (existing) {
        existing.trades.push(t);
        if (entryDate < existing.minDate) existing.minDate = entryDate;
        if (exitDate > existing.maxDate) existing.maxDate = exitDate;
      } else {
        groups.set(gKey, {
          expiry: expiryInfo.expiry,
          isExpired: expiryInfo.isExpired,
          strike,
          optType,
          minDate: entryDate,
          maxDate: exitDate >= entryDate ? exitDate : entryDate,
          trades: [t],
        });
      }
    }

    const groupList = Array.from(groups.values());
    const batchSize = 5;
    for (let i = 0; i < groupList.length; i += batchSize) {
      const batch = groupList.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (g) => {
          const contract = await this.findContract(g.expiry, g.isExpired, g.strike, g.optType);
          if (!contract) return;
          const bars = await this.fetchOption1mCandles(contract, g.minDate, g.maxDate);
          if (!bars || bars.length === 0) return;

          for (const t of g.trades) {
            const fromCandles = resolveTradeFromOptionCandles(
              t,
              bars,
              {
                expiry: contract.expiry,
                strike: contract.strike,
                optType: contract.optType,
                greekDelta: contract.delta,
              },
              NIFTY_LOT_SIZE
            );
            if (fromCandles) {
              resolved[t.id] = fromCandles;
            }
          }
        })
      );
    }

    return resolved;
  }

  /**
   * Extracts real historical 1-minute NIFTY option premiums (CE & PE across each day's
   * active ATM strike range) from Upstox historical/intraday/expired option candles
   * and saves them into PostgreSQL option_chain_snapshots for instant P&L & replay.
   */
  public async backfillHistoricalOptionChain(options: {
    maxDays?: number;
    onSnapshotsCreated?: (snaps: OptionChainSnapshot[]) => Promise<void> | void;
  } = {}): Promise<{
    extractedDays: string[];
    skippedDays: string[];
    snapshotsCreated: number;
  }> {
    if (this.inFlightBackfill) {
      return this.inFlightBackfill;
    }

    const maxDays = Math.max(1, Math.min(25, Number(options.maxDays) || 12));

    const run = (async () => {
      const { getCandles } = await import('../db/market.js');
      const { saveOptionChainSnapshotsBatchToDb } = await import('../db/option-chain.js');

      const spotCandles = await getCandles('NIFTY', 1, 10000);
      if (!spotCandles || spotCandles.length === 0) {
        return { extractedDays: [], skippedDays: [], snapshotsCreated: 0 };
      }

      // Group 1-minute spot candles by IST trading date
      const spotByDay = new Map<string, Array<{ minuteMs: number; close: number }>>();
      for (const c of spotCandles) {
        const tMs = new Date(c.timestamp).getTime();
        const close = Number(c.close);
        if (!Number.isFinite(tMs) || !Number.isFinite(close) || close <= 0) continue;
        const minuteMs = Math.floor(tMs / 60_000) * 60_000;
        const day = toIstDateKey(minuteMs);
        let arr = spotByDay.get(day);
        if (!arr) {
          arr = [];
          spotByDay.set(day, arr);
        }
        arr.push({ minuteMs, close });
      }

      // Count existing recorded snapshots per IST date so we never re-extract already covered days
      const existingCountByDay = new Map<string, number>();
      for (const s of this.getHistory()) {
        if (!s?.timestamp) continue;
        const d = toIstDateKey(Number(s.timestamp));
        existingCountByDay.set(d, (existingCountByDay.get(d) || 0) + 1);
      }

      // Most recent `maxDays` real trading days (excluding flat holiday placeholders)
      const sortedDays = Array.from(spotByDay.keys()).sort().reverse();
      const targetDays: string[] = [];
      const skippedDays: string[] = [];

      for (const day of sortedDays) {
        if (targetDays.length >= maxDays) break;
        const bars = spotByDay.get(day)!;
        if (bars.length < 30) {
          skippedDays.push(day);
          continue;
        }
        const closes = bars.map(b => b.close);
        const minSpot = Math.min(...closes);
        const maxSpot = Math.max(...closes);
        if (maxSpot - minSpot < 1) {
          // Flat holiday placeholder (e.g. NSE holiday)
          skippedDays.push(day);
          continue;
        }
        if ((existingCountByDay.get(day) || 0) >= 100) {
          skippedDays.push(day);
          continue;
        }
        targetDays.push(day);
      }

      const extractedDays: string[] = [];
      let snapshotsCreated = 0;

      // Process oldest-to-newest among targetDays so DB insertion is chronological
      for (const day of targetDays.reverse()) {
        const expiryInfo = await this.resolveExpiryForDate(day);
        if (!expiryInfo) {
          skippedDays.push(day);
          continue;
        }

        const bars = spotByDay.get(day)!.sort((a, b) => a.minuteMs - b.minuteMs);
        const closes = bars.map(b => b.close);
        const minSpot = Math.min(...closes);
        const maxSpot = Math.max(...closes);

        // Cover every 50-pt strike traded on this day ±100 pts (capped to 15 strikes around midpoint)
        let minStrike = Math.floor(minSpot / 50) * 50 - 100;
        let maxStrike = Math.ceil(maxSpot / 50) * 50 + 100;
        const midStrike = Math.round(((minSpot + maxSpot) / 2) / 50) * 50;
        if ((maxStrike - minStrike) / 50 > 14) {
          minStrike = midStrike - 350;
          maxStrike = midStrike + 350;
        }

        const strikes: number[] = [];
        for (let st = minStrike; st <= maxStrike; st += 50) {
          strikes.push(st);
        }

        // Fetch CE & PE 1-minute candles for each strike on this day in throttled batches
        type StrikeSeries = {
          strike: number;
          ceKey: string;
          peKey: string;
          ceDelta?: number;
          peDelta?: number;
          ceByMin: Map<number, OptionCandleBar>;
          peByMin: Map<number, OptionCandleBar>;
        };

        const seriesList: StrikeSeries[] = [];
        const tasks: Array<{ strike: number; optType: 'CE' | 'PE' }> = [];
        for (const st of strikes) {
          tasks.push({ strike: st, optType: 'CE' }, { strike: st, optType: 'PE' });
        }

        const seriesByStrike = new Map<number, StrikeSeries>();
        const batchSize = 6;

        for (let i = 0; i < tasks.length; i += batchSize) {
          const batch = tasks.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async ({ strike, optType }) => {
              const contract = await this.findContract(expiryInfo.expiry, expiryInfo.isExpired, strike, optType);
              if (!contract) return;
              const candleBars = await this.fetchOption1mCandles(contract, day, day);
              if (!candleBars || candleBars.length === 0) return;

              let entry = seriesByStrike.get(strike);
              if (!entry) {
                entry = {
                  strike,
                  ceKey: '',
                  peKey: '',
                  ceByMin: new Map(),
                  peByMin: new Map(),
                };
                seriesByStrike.set(strike, entry);
              }

              if (optType === 'CE') {
                entry.ceKey = contract.instrumentKey;
                entry.ceDelta = contract.delta;
                for (const b of candleBars) {
                  if (toIstDateKey(b.t) === day) entry.ceByMin.set(b.t, b);
                }
              } else {
                entry.peKey = contract.instrumentKey;
                entry.peDelta = contract.delta;
                for (const b of candleBars) {
                  if (toIstDateKey(b.t) === day) entry.peByMin.set(b.t, b);
                }
              }
            })
          );
        }

        for (const st of strikes) {
          const s = seriesByStrike.get(st);
          if (s && (s.ceByMin.size > 0 || s.peByMin.size > 0)) {
            seriesList.push(s);
          }
        }

        if (seriesList.length === 0) {
          skippedDays.push(day);
          continue;
        }

        // Assemble 1-minute OptionChainSnapshot records for this trading day
        const daySnapshots: OptionChainSnapshot[] = [];

        for (const spotBar of bars) {
          const rows: any[] = [];
          let totalCallOI = 0;
          let totalPutOI = 0;
          let maxCallOI = -1;
          let maxPutOI = -1;
          let maxCallStrike = 0;
          let maxPutStrike = 0;

          for (const ser of seriesList) {
            const ceBar = ser.ceByMin.get(spotBar.minuteMs);
            const peBar = ser.peByMin.get(spotBar.minuteMs);
            if (!ceBar && !peBar) continue;

            const ceOi = ceBar?.oi ?? 0;
            const peOi = peBar?.oi ?? 0;
            totalCallOI += ceOi;
            totalPutOI += peOi;
            if (ceOi > maxCallOI) {
              maxCallOI = ceOi;
              maxCallStrike = ser.strike;
            }
            if (peOi > maxPutOI) {
              maxPutOI = peOi;
              maxPutStrike = ser.strike;
            }

            rows.push({
              strike: ser.strike,
              spot: spotBar.close,
              ce: ceBar
                ? {
                    ltp: round2(ceBar.c),
                    volume: ceBar.v,
                    totalOi: ceBar.oi,
                    delta: ser.ceDelta,
                    instrumentKey: ser.ceKey,
                  }
                : {},
              pe: peBar
                ? {
                    ltp: round2(peBar.c),
                    volume: peBar.v,
                    totalOi: peBar.oi,
                    delta: ser.peDelta,
                    instrumentKey: ser.peKey,
                  }
                : {},
            });
          }

          if (rows.length === 0) continue;

          // End of the 1-minute candle (+59s) aligns cleanly with bar-close entry/exit timing
          const snapTs = spotBar.minuteMs + 59_000;
          const pcr = totalCallOI > 0 ? round2(totalPutOI / totalCallOI) : 0;

          daySnapshots.push({
            id: `OC_HIST_${expiryInfo.expiry}_${spotBar.minuteMs}`,
            timestamp: snapTs,
            timeISO: new Date(snapTs).toISOString(),
            instrumentKey: 'NSE_INDEX|Nifty 50',
            expiryDate: expiryInfo.expiry,
            spotPrice: spotBar.close,
            totalCallOI,
            totalPutOI,
            pcr,
            maxCallOIStrike: maxCallStrike,
            maxPutOIStrike: maxPutStrike,
            strikeCount: rows.length,
            ceWalls: [],
            peWalls: [],
            rows,
          });
        }

        if (daySnapshots.length > 0) {
          await saveOptionChainSnapshotsBatchToDb(daySnapshots);
          if (options.onSnapshotsCreated) {
            await options.onSnapshotsCreated(daySnapshots);
          }
          extractedDays.push(day);
          snapshotsCreated += daySnapshots.length;
          console.log(
            `[OptionBackfill] Extracted ${daySnapshots.length} real 1m option chain snapshots for ${day} (exp ${expiryInfo.expiry}, ${seriesList.length} strikes).`
          );
        }
      }

      return { extractedDays, skippedDays, snapshotsCreated };
    })();

    this.inFlightBackfill = run;
    try {
      return await run;
    } finally {
      this.inFlightBackfill = null;
    }
  }
}
