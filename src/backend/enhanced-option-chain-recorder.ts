import { OptionChainSnapshot, Candle } from './types.js';

export interface EnhancedOptionChainRow {
  strike: number;
  spot: number;
  ce: DetailedOptionData;
  pe: DetailedOptionData;
  timestamp: number;
}

export interface DetailedOptionData {
  // Price data
  ltp: number | undefined;
  bid: number | undefined;
  ask: number | undefined;
  bidQty: number | undefined;
  askQty: number | undefined;
  volume: number | undefined;
  
  // OI data
  totalOi: number | undefined;
  oiChange: number | undefined;
  
  // Greeks
  iv: number | undefined;
  delta: number | undefined;
  theta: number | undefined;
  gamma: number | undefined;
  vega: number | undefined;
  
  // Instrument key for execution
  instrumentKey: string;
}

export interface EnhancedOptionChainSnapshot extends OptionChainSnapshot {
  recordingId: string;
  recordedAt: number;
  recordedAtISO: string;
  instrumentKey: string;
  expiryDate: string;
  spotPrice: number;
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
  maxCallOIStrike: number;
  maxPutOIStrike: number;
  strikeCount: number;
  
  // Enhanced field with all columns
  enhancedRows: EnhancedOptionChainRow[];
  
  // Metrics
  callVolumeTotal: number;
  putVolumeTotal: number;
  callIVAvg: number;
  putIVAvg: number;
  atmStrike: number;
  atmCallLTP: number | undefined;
  atmPutLTP: number | undefined;
  atmCallDelta: number | undefined;
  atmPutDelta: number | undefined;
}

export class EnhancedOptionChainRecorder {
  private history: EnhancedOptionChainSnapshot[] = [];
  private maxSnapshots = 10000; // Store up to 10k snapshots
  private lastRecordedTime = 0;
  private recordingInterval = 60000; // Record every 60 seconds during market hours
  
  constructor() {
    this.history = [];
  }

  public recordSnapshot(
    instrumentKey: string,
    expiryDate: string,
    rawRows: any[],
    spotPrice: number,
    timestamp: number
  ): EnhancedOptionChainSnapshot | null {
    try {
      // Enforce minimum interval
      if (timestamp - this.lastRecordedTime < this.recordingInterval - 5000) {
        return null;
      }

      
      // Check for weekly expiry reset (clear history 24 hours after the expiry day ends)
      if (this.history.length > 0) {
        const lastExpiryStr = this.history[0].expiryDate;
        const expiryDateObj = new Date(lastExpiryStr + "T15:30:00+05:30");
        if (!isNaN(expiryDateObj.getTime())) {
          const resetTime = expiryDateObj.getTime() + (24 * 60 * 60 * 1000);
          if (timestamp > resetTime && expiryDate !== lastExpiryStr) {
            console.log(`Clearing history: 24 hours past expiry ${lastExpiryStr}`);
            this.clearHistory();
          }
        }
      }

      if (!Array.isArray(rawRows) || rawRows.length === 0) {

        return null;
      }

      const enhancedRows = this.processRows(rawRows, spotPrice);
      if (enhancedRows.length === 0) {
        return null;
      }

      const snapshot = this.buildSnapshot(
        instrumentKey,
        expiryDate,
        enhancedRows,
        spotPrice,
        timestamp
      );

      this.history.push(snapshot);
      if (this.history.length > this.maxSnapshots) {
        this.history.shift();
      }

      this.lastRecordedTime = timestamp;
      return snapshot;
    } catch (e) {
      console.error('Error recording enhanced option chain snapshot:', e);
      return null;
    }
  }

  private processRows(rawRows: any[], spotPrice: number): EnhancedOptionChainRow[] {
    const enhanced: EnhancedOptionChainRow[] = [];

    let atmStrike = 0;
    let minDiff = Infinity;
    for (const r of rawRows) {
      const diff = Math.abs(r.strike_price - spotPrice);
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

    for (const row of filteredRows) {
      const strike = Number(row.strike_price);
      if (!Number.isFinite(strike)) continue;

      const ce = this.extractOptionData(row.call_options, 'CE');
      const pe = this.extractOptionData(row.put_options, 'PE');

      if (!ce || !pe) continue;

      enhanced.push({
        strike,
        spot: spotPrice,
        ce,
        pe,
        timestamp: Date.now()
      });
    }

    return enhanced.sort((a, b) => a.strike - b.strike);
  }

  private extractOptionData(optData: any, side: 'CE' | 'PE'): DetailedOptionData | null {
    try {
      const md = optData?.market_data || {};
      const greeks = optData?.option_greeks || {};

      const ltp = Number(md.ltp ?? md.last_price);
      const bid = Number(md.bid_price ?? md.bid);
      const ask = Number(md.ask_price ?? md.ask);
      const bidQty = Number(md.bid_qty ?? md.bidQty);
      const askQty = Number(md.ask_qty ?? md.askQty);
      const volume = Number(md.volume);
      const totalOi = Number(md.oi ?? md.total_oi ?? md.totalOi);
      const oiChange = Number(md.oi_change ?? md.oiChange);
      const iv = Number(greeks.iv);
      const delta = Number(greeks.delta);
      const theta = Number(greeks.theta);
      const gamma = Number(greeks.gamma);
      const vega = Number(greeks.vega);
      const instrumentKey = String(optData?.instrument_key || '');

      // Validate minimum required fields
      if (!Number.isFinite(ltp)) {
        return null;
      }

      return {
        ltp: ltp || undefined,
        bid: Number.isFinite(bid) ? bid : undefined,
        ask: Number.isFinite(ask) ? ask : undefined,
        bidQty: Number.isFinite(bidQty) ? bidQty : undefined,
        askQty: Number.isFinite(askQty) ? askQty : undefined,
        volume: Number.isFinite(volume) ? volume : undefined,
        totalOi: Number.isFinite(totalOi) ? totalOi : undefined,
        oiChange: Number.isFinite(oiChange) ? oiChange : undefined,
        iv: Number.isFinite(iv) ? iv : undefined,
        delta: Number.isFinite(delta) ? delta : undefined,
        theta: Number.isFinite(theta) ? theta : undefined,
        gamma: Number.isFinite(gamma) ? gamma : undefined,
        vega: Number.isFinite(vega) ? vega : undefined,
        instrumentKey
      };
    } catch (e) {
      return null;
    }
  }

  private buildSnapshot(
    instrumentKey: string,
    expiryDate: string,
    enhancedRows: EnhancedOptionChainRow[],
    spotPrice: number,
    timestamp: number
  ): EnhancedOptionChainSnapshot {
    let totalCallOI = 0;
    let totalPutOI = 0;
    let maxCallOI = -1;
    let maxPutOI = -1;
    let maxCallOIStrike = 0;
    let maxPutOIStrike = 0;
    let callVolumeTotal = 0;
    let putVolumeTotal = 0;
    let callIVSum = 0;
    let putIVSum = 0;
    let callIVCount = 0;
    let putIVCount = 0;

    for (const row of enhancedRows) {
      const coi = row.ce.totalOi || 0;
      const poi = row.pe.totalOi || 0;

      totalCallOI += coi;
      totalPutOI += poi;

      if (coi > maxCallOI) {
        maxCallOI = coi;
        maxCallOIStrike = row.strike;
      }
      if (poi > maxPutOI) {
        maxPutOI = poi;
        maxPutOIStrike = row.strike;
      }

      if (row.ce.volume) callVolumeTotal += row.ce.volume;
      if (row.pe.volume) putVolumeTotal += row.pe.volume;

      if (Number.isFinite(row.ce.iv)) {
        callIVSum += row.ce.iv;
        callIVCount++;
      }
      if (Number.isFinite(row.pe.iv)) {
        putIVSum += row.pe.iv;
        putIVCount++;
      }
    }

    // Find ATM strike
    let atmStrike = 0;
    let minDiff = Infinity;
    for (const row of enhancedRows) {
      const diff = Math.abs(row.strike - spotPrice);
      if (diff < minDiff) {
        minDiff = diff;
        atmStrike = row.strike;
      }
    }

    const atmRow = enhancedRows.find(r => r.strike === atmStrike);
    const atmCallLTP = atmRow?.ce.ltp;
    const atmPutLTP = atmRow?.pe.ltp;
    const atmCallDelta = atmRow?.ce.delta;
    const atmPutDelta = atmRow?.pe.delta;

    const pcr = totalCallOI > 0 ? Number((totalPutOI / totalCallOI).toFixed(2)) : 0;

    return {
      id: `OCR_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      timeISO: new Date(timestamp).toISOString(),
      recordingId: `OCR_${timestamp}`,
      recordedAt: timestamp,
      recordedAtISO: new Date(timestamp).toISOString(),
      instrumentKey,
      expiryDate,
      spotPrice,
      totalCallOI,
      totalPutOI,
      pcr,
      maxCallOIStrike,
      maxPutOIStrike,
      strikeCount: enhancedRows.length,
      enhancedRows,
      rows: enhancedRows.map(r => ({
        strike: r.strike,
        spot: r.spot,
        ce: r.ce,
        pe: r.pe
      })) as any,
      callVolumeTotal,
      putVolumeTotal,
      callIVAvg: callIVCount > 0 ? callIVSum / callIVCount : 0,
      putIVAvg: putIVCount > 0 ? putIVSum / putIVCount : 0,
      atmStrike,
      atmCallLTP,
      atmPutLTP,
      atmCallDelta,
      atmPutDelta
    };
  }

  public getHistory(): EnhancedOptionChainSnapshot[] {
    return this.history;
  }

  public getHistoryFiltered(
    instrumentKey?: string,
    expiryDate?: string,
    startTime?: number,
    endTime?: number
  ): EnhancedOptionChainSnapshot[] {
    return this.history.filter(snap => {
      if (instrumentKey && snap.instrumentKey !== instrumentKey) return false;
      if (expiryDate && expiryDate !== 'CURRENT' && snap.expiryDate !== expiryDate) return false;
      if (startTime && snap.timestamp < startTime) return false;
      if (endTime && snap.timestamp > endTime) return false;
      return true;
    });
  }

  public clearHistory(): void {
    this.history = [];
    this.lastRecordedTime = 0;
  }

  public getLastSnapshot(): EnhancedOptionChainSnapshot | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  public getSnapshotsInRange(minutesBack: number): EnhancedOptionChainSnapshot[] {
    const cutoffTime = Date.now() - minutesBack * 60 * 1000;
    return this.history.filter(snap => snap.timestamp >= cutoffTime);
  }
}
