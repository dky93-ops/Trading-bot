const fs = require('fs');

const code = `import { AppSettings, AppState, Signal, Candle } from './types.js';
import { getCandles } from '../db/market.js';
import { BollingerBands, ADX, SMA, EMA, ATR, RSI, MACD } from 'technicalindicators';

export type FetchOptionDataFn = (index: string, type: 'CE' | 'PE', spotPrice: number, strikeOffset?: number) => Promise<{ price: number, instrumentKey: string, strike: number } | null>;

export class StrategyEngine {
  private settings: AppSettings;
  private state: AppState;
  public activeSignals: Map<string, Signal> = new Map();
  private fetchOptionData: FetchOptionDataFn;

  constructor(settings: AppSettings, state: AppState, fetchOptionData: FetchOptionDataFn) {
    this.settings = settings;
    this.state = state;
    this.fetchOptionData = fetchOptionData;
  }

  updateSettings(settings: AppSettings) {
    this.settings = settings;
  }

  private calculateDailyVWAP(candles: Candle[]) {
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    const vwapValues: number[] = [];
    
    for (const c of candles) {
        const tp = (c.high + c.low + c.close) / 3;
        cumulativeTPV += tp * c.volume;
        cumulativeVolume += c.volume;
        vwapValues.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : c.close);
    }
    return vwapValues;
  }

  public async onTick(newState: AppState): Promise<Signal[]> {
    this.state = newState;
    let newSignals: Signal[] = [];

    this.manageActiveTrades(newSignals);

    if (!this.settings.isTradingEnabled) return newSignals;

    const todayObj = new Date();
    const timeStr = todayObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const dayOfWeek = todayObj.getDay();

    const tryAddSignal = async (index: string, strategy: string, spot: number, type: 'CE'|'PE', config: any, strikeOffset = 0, timeStop?: string, slPct?: number, tpPct?: number, tradeType?: 'CE'|'PE') => {
       const sig = await this.generateSignal(index, strategy, spot, 'BUY', type, config, strikeOffset, timeStop, slPct, tpPct, tradeType);
       if (sig) newSignals.push(sig);
       return sig;
    };

    const niftyCandles = await getCandles('NIFTY', 15, 60);
    const bankNiftyCandles = await getCandles('BANKNIFTY', 15, 60);
    const nifty5MinCandles = await getCandles('NIFTY', 5, 60);
    const bankNifty5MinCandles = await getCandles('BANKNIFTY', 5, 60);
    const nifty3MinCandles = await getCandles('NIFTY', 3, 60);
    const bankNifty3MinCandles = await getCandles('BANKNIFTY', 3, 60);
    
    niftyCandles.reverse();
    bankNiftyCandles.reverse();
    nifty5MinCandles.reverse();
    bankNifty5MinCandles.reverse();
    nifty3MinCandles.reverse();
    bankNifty3MinCandles.reverse();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayNiftyCandles = niftyCandles.filter(c => new Date(c.timestamp).getTime() >= today.getTime());
    const todayBankNiftyCandles = bankNiftyCandles.filter(c => new Date(c.timestamp).getTime() >= today.getTime());
    const todayNifty5MinCandles = nifty5MinCandles.filter(c => new Date(c.timestamp).getTime() >= today.getTime());
    const todayBankNifty5MinCandles = bankNifty5MinCandles.filter(c => new Date(c.timestamp).getTime() >= today.getTime());

    // 1. Option Chain OI Divergence & Unwinding
    if (this.settings.strategies.oiDivergence?.enabled && timeStr >= '09:30' && timeStr <= '11:30' && this.state.indiaVix.lastPrice >= 13) {
      if (this.settings.nifty50Enabled && todayNiftyCandles.length > 0 && !this.hasSignalToday('OI Divergence', 'NIFTY')) {
        const currentPrice = this.state.nifty50.lastPrice;
        const changeFromOpen = (currentPrice - todayNiftyCandles[0].open) / todayNiftyCandles[0].open;
        if (changeFromOpen >= 0.01) {
            await tryAddSignal('NIFTY', 'OI Divergence', currentPrice, 'CE', this.settings.strategies.oiDivergence, 0, '11:30', -0.35, 1.20, 'CE');
        } else if (changeFromOpen <= -0.01) {
            await tryAddSignal('NIFTY', 'OI Divergence', currentPrice, 'PE', this.settings.strategies.oiDivergence, 0, '11:30', -0.35, 1.20, 'PE');
        }
      }
      if (this.settings.bankNiftyEnabled && todayBankNiftyCandles.length > 0 && !this.hasSignalToday('OI Divergence', 'BANKNIFTY')) {
        const currentPrice = this.state.bankNifty.lastPrice;
        const changeFromOpen = (currentPrice - todayBankNiftyCandles[0].open) / todayBankNiftyCandles[0].open;
        if (changeFromOpen >= 0.01) {
            await tryAddSignal('BANKNIFTY', 'OI Divergence', currentPrice, 'CE', this.settings.strategies.oiDivergence, -1, '11:30', -0.35, 1.20, 'CE');
        } else if (changeFromOpen <= -0.01) {
            await tryAddSignal('BANKNIFTY', 'OI Divergence', currentPrice, 'PE', this.settings.strategies.oiDivergence, 1, '11:30', -0.35, 1.20, 'PE');
        }
      }
    }

    // 2. 1:30 PM Expiry Day "Hero or Zero" Straddle
    if (this.settings.strategies.straddle130?.enabled && timeStr >= '13:25' && timeStr <= '13:35' && this.state.indiaVix.lastPrice > 16) {
      if (this.settings.nifty50Enabled && dayOfWeek === 4 && !this.hasSignalToday('Straddle 1:30 PM', 'NIFTY')) {
        const spot = this.state.nifty50.lastPrice;
        const ce = await tryAddSignal('NIFTY', 'Straddle 1:30 PM', spot, 'CE', this.settings.strategies.straddle130, 0, '15:00', -0.5, 9.99, 'CE');
        const pe = await tryAddSignal('NIFTY', 'Straddle 1:30 PM', spot, 'PE', this.settings.strategies.straddle130, 0, '15:00', -0.5, 9.99, 'PE');
        if (ce && pe) {
           if ((ce.entryPrice + pe.entryPrice) > spot * 0.012) {
             this.activeSignals.delete(ce.id);
             this.activeSignals.delete(pe.id);
             newSignals = newSignals.filter(s => s.id !== ce.id && s.id !== pe.id);
           } else {
             ce.isStraddle = true; pe.isStraddle = true;
           }
        }
      }
      if (this.settings.bankNiftyEnabled && dayOfWeek === 3 && !this.hasSignalToday('Straddle 1:30 PM', 'BANKNIFTY')) {
        const spot = this.state.bankNifty.lastPrice;
        const ce = await tryAddSignal('BANKNIFTY', 'Straddle 1:30 PM', spot, 'CE', this.settings.strategies.straddle130, 0, '15:00', -0.5, 9.99, 'CE');
        const pe = await tryAddSignal('BANKNIFTY', 'Straddle 1:30 PM', spot, 'PE', this.settings.strategies.straddle130, 0, '15:00', -0.5, 9.99, 'PE');
        if (ce && pe) {
           if ((ce.entryPrice + pe.entryPrice) > spot * 0.012) {
             this.activeSignals.delete(ce.id);
             this.activeSignals.delete(pe.id);
             newSignals = newSignals.filter(s => s.id !== ce.id && s.id !== pe.id);
           } else {
             ce.isStraddle = true; pe.isStraddle = true;
           }
        }
      }
    }

    // 3. Bollinger Band Squeeze + India VIX Breakout
    if (this.settings.strategies.bbSqueeze?.enabled && (timeStr < '12:00' || timeStr > '13:30')) {
      const processBBSqueeze = async (index: string, spot: number, candles: Candle[], isEnabled: boolean) => {
        if (!isEnabled || candles.length < 50 || this.hasSignalToday('BB Squeeze + VIX', index)) return;
        const close = candles.map(c => c.close);
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const volume = candles.map(c => c.volume);
        
        const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: close });
        const adxResult = ADX.calculate({ high, low, close, period: 14 });
        if (bb.length < 50 || adxResult.length < 5) return;
        
        const currentBBWidth = (bb[bb.length-1].upper - bb[bb.length-1].lower) / bb[bb.length-1].middle;
        const bbWidths = bb.slice(-50).map(b => (b.upper - b.lower) / b.middle).sort((a,b) => a - b);
        const isSqueeze = currentBBWidth < bbWidths[Math.floor(bbWidths.length * 0.2)];
        
        const adxValid = adxResult.slice(-5).every(a => a.adx < 20);
        const currentCandle = candles[candles.length-1];
        const avgVol = volume.slice(-20).reduce((a,b)=>a+b, 0) / 20;
        const volumeSpike = currentCandle.volume > 2 * avgVol;

        const last3High = Math.max(...high.slice(-3));
        const last3Low = Math.min(...low.slice(-3));
        
        const exitObj = new Date(todayObj.getTime() + 2 * 60 * 60 * 1000);
        const timeStopStr = exitObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

        if (isSqueeze && adxValid && volumeSpike) {
          if (spot > last3High) {
            await tryAddSignal(index, 'BB Squeeze + VIX', spot, 'CE', this.settings.strategies.bbSqueeze, 0, timeStopStr, -0.40, 9.99, 'CE');
          } else if (spot < last3Low) {
            await tryAddSignal(index, 'BB Squeeze + VIX', spot, 'PE', this.settings.strategies.bbSqueeze, 0, timeStopStr, -0.40, 9.99, 'PE');
          }
        }
      };
      await processBBSqueeze('NIFTY', this.state.nifty50.lastPrice, niftyCandles, this.settings.nifty50Enabled);
      await processBBSqueeze('BANKNIFTY', this.state.bankNifty.lastPrice, bankNiftyCandles, this.settings.bankNiftyEnabled);
    }

    // 4. ORB with VWAP
    if (this.settings.strategies.orb?.enabled && timeStr >= '09:20' && timeStr <= '10:30') {
      const processORB = async (index: string, spot: number, candles: Candle[], todayCands: Candle[], isEnabled: boolean, is15Min: boolean) => {
        if (!isEnabled || todayCands.length === 0 || this.hasSignalToday('ORB', index) || candles.length < 15) return;
        const orbCandle = is15Min ? todayCands[0] : todayCands[0]; 
        const vwap = this.calculateDailyVWAP(todayCands);
        const currentVwap = vwap[vwap.length-1];

        // TWEAK 1: ADX Filter
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const close = candles.map(c => c.close);
        const adxResult = ADX.calculate({ high, low, close, period: 14 });
        if (adxResult.length < 1) return;
        const lastAdx = adxResult[adxResult.length-1].adx;
        if (lastAdx < 18) return; // Discard false breakout

        // TWEAK 2: Gap Filter
        const prevDayCandles = candles.filter(c => new Date(c.timestamp).getTime() < today.getTime());
        if (prevDayCandles.length > 0) {
            const prevClose = prevDayCandles[prevDayCandles.length-1].close;
            const gapPct = Math.abs(orbCandle.open - prevClose) / prevClose;
            if (gapPct > 0.012) {
                // If gap > 1.2%, price must return to VWAP first
                const distToVWAP = Math.abs(spot - currentVwap) / spot;
                if (distToVWAP > 0.002) return; // wait until it touches VWAP
            }
        }
        
        if (spot > orbCandle.high && spot > currentVwap) {
          await tryAddSignal(index, 'ORB', spot, 'CE', this.settings.strategies.orb, 0, '10:30', -0.40, 0.60, 'CE'); 
        } else if (spot < orbCandle.low && spot < currentVwap) {
          await tryAddSignal(index, 'ORB', spot, 'PE', this.settings.strategies.orb, 0, '10:30', -0.40, 0.60, 'PE');
        }
      };
      await processORB('NIFTY', this.state.nifty50.lastPrice, nifty5MinCandles, todayNifty5MinCandles, this.settings.nifty50Enabled, true);
      await processORB('BANKNIFTY', this.state.bankNifty.lastPrice, bankNifty5MinCandles, todayBankNifty5MinCandles, this.settings.bankNiftyEnabled, false);
    }

    // 5. High-Frequency ADX-Filtered 9 EMA Trend Rider
    if (this.settings.strategies.adx9Ema?.enabled) {
      const processTrendRider = async (index: string, spot: number, candles: Candle[], isEnabled: boolean) => {
        if (!isEnabled || candles.length < 21) return;
        const close = candles.map(c => c.close);
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const ema9 = EMA.calculate({ period: 9, values: close });
        const ema21 = EMA.calculate({ period: 21, values: close });
        const adxResult = ADX.calculate({ high, low, close, period: 14 });
        
        if (ema9.length < 1 || ema21.length < 1 || adxResult.length < 1) return;
        const lastEma9 = ema9[ema9.length-1];
        const lastEma21 = ema21[ema21.length-1];
        const lastAdx = adxResult[adxResult.length-1];
        
        const currentCandle = candles[candles.length-1];
        const touched9Ema = currentCandle.low <= lastEma9 && currentCandle.close > lastEma9;
        
        if (lastEma9 > lastEma21 && lastAdx.adx > 25 && lastAdx.pdi > lastAdx.mdi && touched9Ema && !this.hasSignalToday('ADX 9 EMA Trend', index)) {
          const strikeOffset = index === 'BANKNIFTY' ? -1 : 0; 
          await tryAddSignal(index, 'ADX 9 EMA Trend', spot, 'CE', this.settings.strategies.adx9Ema, strikeOffset, undefined, -0.35, 9.99, 'CE');
        }
      };
      await processTrendRider('NIFTY', this.state.nifty50.lastPrice, nifty3MinCandles, this.settings.nifty50Enabled);
      await processTrendRider('BANKNIFTY', this.state.bankNifty.lastPrice, bankNifty3MinCandles, this.settings.bankNiftyEnabled);
    }

    // 6. VWAP Bounce / Rejection
    if (this.settings.strategies.vwapBounce?.enabled && ((timeStr >= '10:30' && timeStr <= '12:00') || (timeStr >= '13:30' && timeStr <= '14:30'))) {
       const processVWAPBounce = async (index: string, spot: number, todayCands: Candle[], isEnabled: boolean) => {
         if (!isEnabled || todayCands.length < 2 || this.hasSignalToday('VWAP Bounce', index)) return;
         const vwap = this.calculateDailyVWAP(todayCands);
         const currentVwap = vwap[vwap.length-1];
         const lastCandle = todayCands[todayCands.length-1];
         
         const isBounce = lastCandle.low <= currentVwap && lastCandle.close > currentVwap;
         const isRejection = lastCandle.high >= currentVwap && lastCandle.close < currentVwap;
         
         if (isBounce) {
           await tryAddSignal(index, 'VWAP Bounce', spot, 'CE', this.settings.strategies.vwapBounce, 0, undefined, -0.30, 1.0, 'CE'); 
         } else if (isRejection) {
           await tryAddSignal(index, 'VWAP Bounce', spot, 'PE', this.settings.strategies.vwapBounce, 0, undefined, -0.30, 1.0, 'PE');
         }
       };
       await processVWAPBounce('NIFTY', this.state.nifty50.lastPrice, todayNifty5MinCandles, this.settings.nifty50Enabled);
       await processVWAPBounce('BANKNIFTY', this.state.bankNifty.lastPrice, todayBankNifty5MinCandles, this.settings.bankNiftyEnabled);
    }

    // 7. Inside Bar Breakout
    if (this.settings.strategies.insideBar?.enabled && (timeStr < '11:45' || timeStr > '13:30')) {
       const processInsideBar = async (index: string, spot: number, candles: Candle[], isEnabled: boolean) => {
         if (!isEnabled || candles.length < 3 || this.hasSignalToday('Inside Bar Breakout', index)) return;
         const mother = candles[candles.length - 3];
         const baby = candles[candles.length - 2];
         
         // TWEAK: Volume contraction for higher win-rate
         const volContraction = baby.volume < mother.volume * 0.60;

         if (baby.high < mother.high && baby.low > mother.low && volContraction) {
           if (spot > mother.high) {
             await tryAddSignal(index, 'Inside Bar Breakout', spot, 'CE', this.settings.strategies.insideBar, 0, undefined, -0.40, 0.80, 'CE');
           } else if (spot < mother.low) {
             await tryAddSignal(index, 'Inside Bar Breakout', spot, 'PE', this.settings.strategies.insideBar, 0, undefined, -0.40, 0.80, 'PE');
           }
         }
       };
       await processInsideBar('NIFTY', this.state.nifty50.lastPrice, niftyCandles, this.settings.nifty50Enabled);
       await processInsideBar('BANKNIFTY', this.state.bankNifty.lastPrice, bankNiftyCandles, this.settings.bankNiftyEnabled);
    }

    // 8. 2:00 PM Gamma Scalping
    if (this.settings.strategies.gammaScalping?.enabled && timeStr >= '13:55' && timeStr <= '14:05') {
       if (this.settings.nifty50Enabled && dayOfWeek === 4 && !this.hasSignalToday('Gamma Scalping', 'NIFTY')) {
           const spot = this.state.nifty50.lastPrice;
           const momentum = nifty5MinCandles[nifty5MinCandles.length - 1].close - nifty5MinCandles[nifty5MinCandles.length - 2].close;
           if (momentum > 0) {
               await tryAddSignal('NIFTY', 'Gamma Scalping', spot, 'CE', this.settings.strategies.gammaScalping, 0, '14:45', -0.50, 9.99, 'CE');
           } else {
               await tryAddSignal('NIFTY', 'Gamma Scalping', spot, 'PE', this.settings.strategies.gammaScalping, 0, '14:45', -0.50, 9.99, 'PE');
           }
       }
       if (this.settings.bankNiftyEnabled && dayOfWeek === 3 && !this.hasSignalToday('Gamma Scalping', 'BANKNIFTY')) {
           const spot = this.state.bankNifty.lastPrice;
           const momentum = bankNifty5MinCandles[bankNifty5MinCandles.length - 1].close - bankNifty5MinCandles[bankNifty5MinCandles.length - 2].close;
           if (momentum > 0) {
               await tryAddSignal('BANKNIFTY', 'Gamma Scalping', spot, 'CE', this.settings.strategies.gammaScalping, 0, '14:45', -0.50, 9.99, 'CE');
           } else {
               await tryAddSignal('BANKNIFTY', 'Gamma Scalping', spot, 'PE', this.settings.strategies.gammaScalping, 0, '14:45', -0.50, 9.99, 'PE');
           }
       }
    }

    // ---------------------------------------------
    // NEW STRATEGY 1: CPR Breakout / Rejection
    // ---------------------------------------------
    if (this.settings.strategies.cprBreakout?.enabled) {
      const processCPR = async (index: string, spot: number, candles: Candle[], todayCands: Candle[], isEnabled: boolean) => {
        if (!isEnabled || todayCands.length < 1 || this.hasSignalToday('CPR Breakout', index)) return;
        const prevDayCandles = candles.filter(c => new Date(c.timestamp).getTime() < today.getTime());
        if (prevDayCandles.length === 0) return;
        
        let ph = -Infinity, pl = Infinity, pc = 0;
        prevDayCandles.forEach(c => {
           if (c.high > ph) ph = c.high;
           if (c.low < pl) pl = c.low;
           pc = c.close;
        });
        
        const pivot = (ph + pl + pc) / 3;
        const bc = (ph + pl) / 2;
        const tc = (pivot - bc) + pivot;
        const cprHigh = Math.max(bc, tc);
        const cprLow = Math.min(bc, tc);
        
        const currentCandle = todayCands[todayCands.length - 1];
        
        // Breakout from top of CPR
        if (currentCandle.open <= cprHigh && currentCandle.close > cprHigh && spot > cprHigh) {
            await tryAddSignal(index, 'CPR Breakout', spot, 'CE', this.settings.strategies.cprBreakout, 0, undefined, -0.25, 0.70, 'CE');
        }
        // Breakdown from bottom of CPR
        else if (currentCandle.open >= cprLow && currentCandle.close < cprLow && spot < cprLow) {
            await tryAddSignal(index, 'CPR Breakout', spot, 'PE', this.settings.strategies.cprBreakout, 0, undefined, -0.25, 0.70, 'PE');
        }
      };
      await processCPR('NIFTY', this.state.nifty50.lastPrice, nifty15Candles(niftyCandles), todayNiftyCandles, this.settings.nifty50Enabled);
      await processCPR('BANKNIFTY', this.state.bankNifty.lastPrice, nifty15Candles(bankNiftyCandles), todayBankNiftyCandles, this.settings.bankNiftyEnabled);
    }
    
    // Helper func
    function nifty15Candles(candles: Candle[]) { return candles; } // already 15m

    // ---------------------------------------------
    // NEW STRATEGY 2: Gap Fill Reversal
    // ---------------------------------------------
    if (this.settings.strategies.gapFill?.enabled && timeStr >= '09:30' && timeStr <= '10:30') {
      const processGapFill = async (index: string, spot: number, candles: Candle[], todayCands: Candle[], isEnabled: boolean) => {
        if (!isEnabled || todayCands.length < 1 || this.hasSignalToday('Gap Fill', index)) return;
        const prevDayCandles = candles.filter(c => new Date(c.timestamp).getTime() < today.getTime());
        if (prevDayCandles.length === 0) return;
        const prevClose = prevDayCandles[prevDayCandles.length-1].close;
        const firstCandle = todayCands[0];
        
        const gapPct = (firstCandle.open - prevClose) / prevClose;
        
        // Gap up > 0.5%, rejected
        if (gapPct > 0.005 && firstCandle.close < firstCandle.open) {
            if (spot < firstCandle.low) {
               await tryAddSignal(index, 'Gap Fill', spot, 'PE', this.settings.strategies.gapFill, 0, undefined, -0.25, 0.75, 'PE');
            }
        }
        // Gap down > 0.5%, rejected
        else if (gapPct < -0.005 && firstCandle.close > firstCandle.open) {
            if (spot > firstCandle.high) {
               await tryAddSignal(index, 'Gap Fill', spot, 'CE', this.settings.strategies.gapFill, 0, undefined, -0.25, 0.75, 'CE');
            }
        }
      };
      await processGapFill('NIFTY', this.state.nifty50.lastPrice, niftyCandles, todayNiftyCandles, this.settings.nifty50Enabled);
      await processGapFill('BANKNIFTY', this.state.bankNifty.lastPrice, bankNiftyCandles, todayBankNiftyCandles, this.settings.bankNiftyEnabled);
    }

    // ---------------------------------------------
    // NEW STRATEGY 3: MACD Divergence
    // ---------------------------------------------
    if (this.settings.strategies.macdDivergence?.enabled) {
      const processMACD = async (index: string, spot: number, candles: Candle[], isEnabled: boolean) => {
        if (!isEnabled || candles.length < 35 || this.hasSignalToday('MACD Divergence', index)) return;
        const close = candles.map(c => c.close);
        
        const macdResult = MACD.calculate({ values: close, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        if (macdResult.length < 3) return;
        
        const lastMacd = macdResult[macdResult.length-1];
        const prevMacd = macdResult[macdResult.length-2];
        const prev2Macd = macdResult[macdResult.length-3];
        
        if (!lastMacd.histogram || !prevMacd.histogram || !prev2Macd.histogram) return;
        
        // Bullish Crossover below 0
        if (prevMacd.histogram < 0 && lastMacd.histogram > 0 && lastMacd.MACD && lastMacd.MACD < 0) {
            await tryAddSignal(index, 'MACD Divergence', spot, 'CE', this.settings.strategies.macdDivergence, 0, undefined, -0.30, 0.80, 'CE');
        }
        // Bearish Crossover above 0
        else if (prevMacd.histogram > 0 && lastMacd.histogram < 0 && lastMacd.MACD && lastMacd.MACD > 0) {
            await tryAddSignal(index, 'MACD Divergence', spot, 'PE', this.settings.strategies.macdDivergence, 0, undefined, -0.30, 0.80, 'PE');
        }
      };
      await processMACD('NIFTY', this.state.nifty50.lastPrice, nifty15Candles(niftyCandles), this.settings.nifty50Enabled);
      await processMACD('BANKNIFTY', this.state.bankNifty.lastPrice, nifty15Candles(bankNiftyCandles), this.settings.bankNiftyEnabled);
    }

    newSignals.forEach(s => this.activeSignals.set(s.id, s));
    return newSignals;
  }

  private manageActiveTrades(newSignals: Signal[]) {
    const todayObj = new Date();
    const timeStr = todayObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

    for (const [id, signal] of this.activeSignals.entries()) {
      const currentOptPrice = signal.latestPrice || signal.entryPrice;
      const profitPercent = (currentOptPrice - signal.entryPrice) / signal.entryPrice;
      
      signal.highestPrice = Math.max(signal.highestPrice || currentOptPrice, currentOptPrice);

      if (signal.timeStop && timeStr >= signal.timeStop) {
         this.closeSignal(signal, currentOptPrice, 'TIME STOP');
         newSignals.push(signal);
         continue;
      }

      if (currentOptPrice <= signal.stopLoss) {
         this.closeSignal(signal, signal.stopLoss, 'SL HIT');
         newSignals.push(signal);
         continue;
      }

      if (signal.strategy === 'OI Divergence') {
        if (!signal.partialExit && profitPercent >= 0.60) {
          signal.partialExit = true;
          signal.stopLoss = signal.entryPrice; 
          console.log(\`Partial Exit at 60% for \${signal.id}\`);
        }
        if (profitPercent >= 1.20) {
          this.closeSignal(signal, currentOptPrice, 'TARGET HIT');
          newSignals.push(signal);
        }
      } 
      else if (signal.strategy === 'Straddle 1:30 PM') {
         if (profitPercent >= 0.80) {
            const trailingSL = signal.entryPrice + (profitPercent * 0.60) * signal.entryPrice; 
            signal.stopLoss = Math.max(signal.stopLoss, trailingSL);
         }
      }
      else if (signal.strategy === 'BB Squeeze + VIX') {
         if (profitPercent >= 0.50) {
            const peakProfit = (signal.highestPrice - signal.entryPrice) / signal.entryPrice;
            const retracementSL = signal.entryPrice + (peakProfit * 0.75 * signal.entryPrice); 
            signal.stopLoss = Math.max(signal.stopLoss, retracementSL);
         }
      }
      else if (signal.strategy === 'ORB') {
         if (profitPercent >= 0.01 && !signal.breakevenShifted) {
            signal.stopLoss = signal.entryPrice;
            signal.breakevenShifted = true;
         }
         if (profitPercent >= 0.60 && !signal.partialExit) {
            signal.partialExit = true;
         }
         if (signal.partialExit) {
            const peakProfit = (signal.highestPrice - signal.entryPrice) / signal.entryPrice;
            const retracementSL = signal.entryPrice + (peakProfit * 0.80 * signal.entryPrice);
            signal.stopLoss = Math.max(signal.stopLoss, retracementSL);
         }
      }
      else if (signal.strategy === 'ADX 9 EMA Trend') {
         if (profitPercent >= 0.50) {
            const step = Math.floor(profitPercent / 0.20) * 0.20;
            signal.stopLoss = Math.max(signal.stopLoss, signal.entryPrice * (1 + step));
         }
      }
      else if (signal.strategy === 'VWAP Bounce') {
         if (profitPercent >= 0.50 && !signal.partialExit) {
            signal.partialExit = true;
            signal.stopLoss = signal.entryPrice;
         }
         if (profitPercent >= 1.0) {
            this.closeSignal(signal, currentOptPrice, 'TARGET HIT');
            newSignals.push(signal);
         }
      }
      else if (signal.strategy === 'Inside Bar Breakout' || signal.strategy === 'CPR Breakout' || signal.strategy === 'Gap Fill' || signal.strategy === 'MACD Divergence') {
         // Generic trailing for new strategies
         if (profitPercent >= 0.80 && !signal.partialExit) {
            signal.partialExit = true;
         }
         if (signal.partialExit) {
            const peakProfit = (signal.highestPrice - signal.entryPrice) / signal.entryPrice;
            const retracementSL = signal.entryPrice + (peakProfit * 0.75 * signal.entryPrice);
            signal.stopLoss = Math.max(signal.stopLoss, retracementSL);
         }
      }
      else if (signal.strategy === 'Gamma Scalping') {
         if (profitPercent >= 1.0) {
            if (profitPercent >= 3.0) {
               signal.stopLoss = Math.max(signal.stopLoss, signal.entryPrice * (1 + 2.0));
            } else if (profitPercent >= 2.0) {
               signal.stopLoss = Math.max(signal.stopLoss, signal.entryPrice * (1 + 1.0));
            } else {
               signal.stopLoss = Math.max(signal.stopLoss, signal.entryPrice * (1 + 0.30));
            }
         }
      }
      else {
        if (currentOptPrice >= signal.target) {
          this.closeSignal(signal, currentOptPrice, 'TARGET HIT');
          newSignals.push(signal);
        }
      }
    }
  }

  public exitAllActiveTrades(reason: string) {
    for (const [id, signal] of this.activeSignals.entries()) {
        const currentOptPrice = signal.latestPrice || signal.entryPrice;
        this.closeSignal(signal, currentOptPrice, reason);
    }
  }

  private closeSignal(signal: Signal, exitPrice: number, reason: string) {
    signal.status = 'CLOSED';
    signal.exitPrice = exitPrice;
    signal.exitTime = Date.now();
    
    const lotSize = signal.index === 'NIFTY' ? 50 : 15;
    const config = this.getStrategyConfig(signal.strategy);
    let qtyMultiplier = 1.0;
    if (signal.partialExit) {
       qtyMultiplier = (signal.strategy === 'ORB' ? 0.7 : 0.5); 
    }
    const qty = lotSize * (config?.lotSize || 1) * qtyMultiplier;
    
    signal.realizedPnL = (exitPrice - signal.entryPrice) * qty;
    if (signal.partialExit) {
       let partialProfitPct = 0;
       if (signal.strategy === 'OI Divergence') partialProfitPct = 0.60;
       if (signal.strategy === 'ORB') partialProfitPct = 0.60;
       if (signal.strategy === 'VWAP Bounce') partialProfitPct = 0.50;
       if (signal.strategy === 'Inside Bar Breakout' || signal.strategy === 'CPR Breakout' || signal.strategy === 'Gap Fill' || signal.strategy === 'MACD Divergence') partialProfitPct = 0.80;
       
       const partialQty = lotSize * (config?.lotSize || 1) * (1 - qtyMultiplier);
       signal.realizedPnL += (signal.entryPrice * partialProfitPct) * partialQty;
    }

    this.activeSignals.delete(signal.id);
  }

  private async generateSignal(index: string, strategyName: string, spotPrice: number, action: 'BUY', type: 'CE'|'PE', config: any, strikeOffset = 0, timeStop?: string, slPct?: number, tpPct?: number, tradeType?: 'CE'|'PE'): Promise<Signal | null> {
    const optData = await this.fetchOptionData(index, type, spotPrice, strikeOffset);
    if (!optData || optData.price <= 0) return null;

    const premium = optData.price;
    const slFactor = slPct !== undefined ? slPct : -(config?.slPercent / 100 || 0.3);
    const tpFactor = tpPct !== undefined ? tpPct : (config?.targetPercent / 100 || 0.8);

    return {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      index,
      contract: \`\${index} \${optData.strike} \${type}\`,
      instrumentKey: optData.instrumentKey,
      action,
      strategy: strategyName,
      entryPrice: premium,
      latestPrice: premium,
      highestPrice: premium,
      stopLoss: premium + (premium * slFactor),
      target: premium + (premium * tpFactor),
      status: 'ACTIVE',
      timeStop,
      tradeType
    };
  }

  private hasSignalToday(strategy: string, index: string): boolean {
    const today = new Date().setHours(0,0,0,0);
    return this.state.signals.some(s => s.strategy === strategy && s.index === index && new Date(s.timestamp).getTime() > today) || 
           Array.from(this.activeSignals.values()).some(s => s.strategy === strategy && s.index === index && new Date(s.timestamp).getTime() > today);
  }

  private getStrategyConfig(strategyName: string) {
    switch (strategyName) {
      case 'Straddle 1:30 PM': return this.settings.strategies.straddle130;
      case 'OI Divergence': return this.settings.strategies.oiDivergence;
      case 'BB Squeeze + VIX': return this.settings.strategies.bbSqueeze;
      case 'ORB': return this.settings.strategies.orb;
      case 'ADX 9 EMA Trend': return this.settings.strategies.adx9Ema;
      case 'VWAP Bounce': return this.settings.strategies.vwapBounce;
      case 'Inside Bar Breakout': return this.settings.strategies.insideBar;
      case 'Gamma Scalping': return this.settings.strategies.gammaScalping;
      case 'CPR Breakout': return this.settings.strategies.cprBreakout;
      case 'Gap Fill': return this.settings.strategies.gapFill;
      case 'MACD Divergence': return this.settings.strategies.macdDivergence;
      default: return this.settings.strategies.straddle130;
    }
  }
}
`
fs.writeFileSync('src/backend/strategy-engine.ts', code);
