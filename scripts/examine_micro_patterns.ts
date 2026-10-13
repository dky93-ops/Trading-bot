import { getCandles } from '../src/db/market.ts';
import { computeSamSignals, DEFAULT_SAM_CONFIG } from '../src/backend/sam-signals.ts';
import { computeSMA, computeEMA, computeADX, computeATR, computeRSI } from '../src/backend/technical-indicators.ts';
import * as fs from 'fs';

async function main() {
  const rawCandles = await getCandles('NIFTY', 1, 1000);
  const filtered = rawCandles.filter(c => {
    const d = new Date(c.timestamp);
    const istTime = new Date(d.getTime() + 19800000);
    const hh = istTime.getUTCHours();
    const mm = istTime.getUTCMinutes();
    const timeNum = hh * 100 + mm;
    return timeNum >= 915 && timeNum <= 1530;
  });
  const candlesToUse = (filtered.length >= 25 ? filtered : rawCandles).slice(0, 1000);

  const formatted = candlesToUse.slice().reverse().map(c => {
    const dateObj = new Date(c.timestamp);
    return {
      time: Math.floor(dateObj.getTime() / 1000) + 19800,
      timestamp: c.timestamp,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0),
    };
  });

  const sorted = formatted.sort((a, b) => a.time - b.time);
  const candles = sorted.filter((v, i, a) => a.findIndex(t => t.time === v.time) === i);

  const samResult = computeSamSignals(candles, DEFAULT_SAM_CONFIG);
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const opens = candles.map(c => c.open);
  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);
  const ema200 = computeEMA(closes, 200);
  const atr14 = computeATR(highs, lows, closes, 14);
  const adxData = computeADX(highs, lows, closes, 14);

  const slPts = 20;
  const tpPts = 60;
  const trailingEnabled = true;
  const step1 = 20;
  const step2 = 40;
  const step2Lock = 20;

  const openTrades: any[] = [];
  const completedTrades: any[] = [];

  for (let i = 0; i < candles.length; i++) {
    const curr = candles[i];
    const d = new Date(curr.time * 1000);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const isPreMarket = mins < 9 * 60 + 15;
    const isDayEnd = mins >= 15 * 60 + 25;

    // Manage open trades
    for (let j = openTrades.length - 1; j >= 0; j--) {
      const t = openTrades[j];
      const isEntryBar = curr.time === t.entryTime;

      if (t.type === 'LONG') {
        if (!isEntryBar) {
          t.peakPrice = Math.max(t.peakPrice || t.entryPrice, curr.high);
          if (trailingEnabled) {
            if (t.peakPrice >= t.entryPrice + step2) {
              const newSl = Number((t.entryPrice + step2Lock).toFixed(2));
              if (newSl > t.stoploss) t.stoploss = newSl;
            } else if (t.peakPrice >= t.entryPrice + step1) {
              const newSl = Number(t.entryPrice.toFixed(2));
              if (newSl > t.stoploss) t.stoploss = newSl;
            }
          }
        }
        if (curr.low <= t.stoploss) {
          t.exitPrice = t.stoploss;
          t.exitTime = curr.time;
          t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
          t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
          t.exitReason = t.pnl === 0 ? 'BREAKEVEN' : 'STOPLOSS';
          t.durationBars = i - t.barIdx;
          completedTrades.push(t);
          openTrades.splice(j, 1);
          continue;
        } else if (curr.high >= t.target) {
          t.exitPrice = t.target;
          t.exitTime = curr.time;
          t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
          t.status = 'WIN';
          t.exitReason = 'TARGET';
          t.durationBars = i - t.barIdx;
          completedTrades.push(t);
          openTrades.splice(j, 1);
          continue;
        } else if (DEFAULT_SAM_CONFIG.autoExitOpposite && samResult.putSignals[i]) {
          t.exitPrice = curr.close;
          t.exitTime = curr.time;
          t.pnl = Number((curr.close - t.entryPrice).toFixed(2));
          t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
          t.exitReason = 'OPPOSITE_SIGNAL';
          t.durationBars = i - t.barIdx;
          completedTrades.push(t);
          openTrades.splice(j, 1);
          continue;
        } else if (isDayEnd) {
          t.exitPrice = curr.close;
          t.exitTime = curr.time;
          t.pnl = Number((curr.close - t.entryPrice).toFixed(2));
          t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
          t.exitReason = 'DAY_END';
          t.durationBars = i - t.barIdx;
          completedTrades.push(t);
          openTrades.splice(j, 1);
          continue;
        }
      } else {
        if (!isEntryBar) {
          t.peakPrice = Math.min(t.peakPrice || t.entryPrice, curr.low);
          if (trailingEnabled) {
            if (t.peakPrice <= t.entryPrice - step2) {
              const newSl = Number((t.entryPrice - step2Lock).toFixed(2));
              if (newSl < t.stoploss) t.stoploss = newSl;
            } else if (t.peakPrice <= t.entryPrice - step1) {
              const newSl = Number(t.entryPrice.toFixed(2));
              if (newSl < t.stoploss) t.stoploss = newSl;
            }
          }
        }
        if (curr.high >= t.stoploss) {
          t.exitPrice = t.stoploss;
          t.exitTime = curr.time;
          t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
          t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
          t.exitReason = t.pnl === 0 ? 'BREAKEVEN' : 'STOPLOSS';
          t.durationBars = i - t.barIdx;
          completedTrades.push(t);
          openTrades.splice(j, 1);
          continue;
        } else if (curr.low <= t.target) {
          t.exitPrice = t.target;
          t.exitTime = curr.time;
          t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
          t.status = 'WIN';
          t.exitReason = 'TARGET';
          t.durationBars = i - t.barIdx;
          completedTrades.push(t);
          openTrades.splice(j, 1);
          continue;
        } else if (DEFAULT_SAM_CONFIG.autoExitOpposite && samResult.callSignals[i]) {
          t.exitPrice = curr.close;
          t.exitTime = curr.time;
          t.pnl = Number((t.entryPrice - curr.close).toFixed(2));
          t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
          t.exitReason = 'OPPOSITE_SIGNAL';
          t.durationBars = i - t.barIdx;
          completedTrades.push(t);
          openTrades.splice(j, 1);
          continue;
        } else if (isDayEnd) {
          t.exitPrice = curr.close;
          t.exitTime = curr.time;
          t.pnl = Number((t.entryPrice - curr.close).toFixed(2));
          t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
          t.exitReason = 'DAY_END';
          t.durationBars = i - t.barIdx;
          completedTrades.push(t);
          openTrades.splice(j, 1);
          continue;
        }
      }
    }

    // New Entry
    if (!isDayEnd && !isPreMarket && i >= 35) {
      const hasActiveTrade = openTrades.length > 0;
      if (!hasActiveTrade) {
        const isCall = samResult.callSignals[i];
        const isPut = samResult.putSignals[i];

        if (isCall || isPut) {
          const type = isCall ? 'LONG' : 'SHORT';
          const entry = curr.close;
          const stoploss = Number((type === 'LONG' ? entry - slPts : entry + slPts).toFixed(2));
          const target = Number((type === 'LONG' ? entry + tpPts : entry - tpPts).toFixed(2));

          // Follow through analysis:
          // Check next 1, 2, 3 bars
          const b1 = i + 1 < candles.length ? candles[i + 1] : null;
          const b2 = i + 2 < candles.length ? candles[i + 2] : null;

          // Did bar + 1 make a lower low (for LONG) or higher high (for SHORT)?
          const b1AdverseExtreme = b1 ? (type === 'LONG' ? b1.low < curr.low : b1.high > curr.high) : false;
          // Did bar + 1 close lower than entry (for LONG) or higher than entry (for SHORT)?
          const b1AdverseClose = b1 ? (type === 'LONG' ? b1.close < curr.close : b1.close > curr.close) : false;

          // Did bar + 1 violate entry bar low/high immediately? (Immediate Failure Trap)
          const b1BrokeEntryBarInvalidation = b1 ? (type === 'LONG' ? b1.low <= curr.low : b1.high >= curr.high) : false;

          // Preceding bar check:
          // Was entry bar an expansion bar after contraction?
          const prevBar = candles[i - 1];
          const entryRange = curr.high - curr.low;
          const prevRange = prevBar.high - prevBar.low;
          const isExpansion = entryRange > 1.5 * prevRange;

          // Was entry bar close near the extreme (strong close) or weak close?
          const closePctOfRange = entryRange > 0 
            ? (type === 'LONG' ? (curr.close - curr.low) / entryRange : (curr.high - curr.close) / entryRange)
            : 0.5;
          const isWeakClose = closePctOfRange < 0.6; // Closed in bottom 40% of its range despite signal!

          // Crossover Spread: buffer1 - buffer2
          const bufferSpread = Math.abs(samResult.buffer1[i] - samResult.buffer2[i]);
          const atr = atr14[i] || 1;

          // Trend Alignment:
          const isAlignedWithEma20 = type === 'LONG' ? curr.close > ema20[i] : curr.close < ema20[i];
          const isAlignedWithEma50 = type === 'LONG' ? curr.close > ema50[i] : curr.close < ema50[i];
          const isAlignedWithEma200 = type === 'LONG' ? curr.close > ema200[i] : curr.close < ema200[i];

          // Macro trend: EMA 50 slope
          const ema50Slope = i >= 5 ? ema50[i] - ema50[i - 5] : 0;
          const isEma50Opposite = type === 'LONG' ? ema50Slope < -0.5 : ema50Slope > 0.5;

          // Consecutive Crossover Count in last 10 bars (Whipsaw Zone)
          let crossesLast10 = 0;
          for (let k = Math.max(0, i - 10); k <= i; k++) {
            if (samResult.callSignals[k] || samResult.putSignals[k]) crossesLast10++;
          }

          // Buffer2 Slope at Signal
          const b2Slope = i >= 2 ? samResult.buffer2[i] - samResult.buffer2[i - 2] : 0;
          const isB2SlopeCounter = type === 'LONG' ? b2Slope < 0 : b2Slope > 0;

          const trade = {
            id: `${curr.time}-${type}`,
            barIdx: i,
            type,
            entryTime: curr.time,
            timeIST: new Date(curr.time * 1000).toISOString().replace('Z', ' IST'),
            entryPrice: entry,
            stoploss,
            target,
            peakPrice: entry,
            status: 'OPEN',
            durationBars: 0,
            
            b1AdverseClose,
            b1AdverseExtreme,
            b1BrokeEntryBarInvalidation,
            isWeakClose,
            closePctOfRange,
            isAlignedWithEma20,
            isAlignedWithEma50,
            isAlignedWithEma200,
            isEma50Opposite,
            crossesLast10,
            isWhipsawDense: crossesLast10 >= 2,
            isB2SlopeCounter,
            bufferSpreadVsAtr: bufferSpread / atr,
            isMicroCrossover: (bufferSpread / atr) < 0.25, // Barely crossed over
          };

          openTrades.push(trade);
        }
      }
    }
  }

  const wins = completedTrades.filter(t => t.status === 'WIN');
  const losses = completedTrades.filter(t => t.status === 'LOSS');

  console.log(`Analyzing ${completedTrades.length} trades (${wins.length} wins, ${losses.length} losses)`);

  const checks = [
    {
      name: 'Immediate Next Bar Invalidation (Bar +1 immediately broke Entry Bar High/Low)',
      fn: (t: any) => t.b1BrokeEntryBarInvalidation
    },
    {
      name: 'Immediate Adverse Close (Bar +1 closed in opposite direction of trade)',
      fn: (t: any) => t.b1AdverseClose
    },
    {
      name: 'Immediate Adverse Extreme (Bar +1 made new adverse wick beyond entry)',
      fn: (t: any) => t.b1AdverseExtreme
    },
    {
      name: 'Weak Signal Candle Close (<60% close in direction of signal / rejection wick)',
      fn: (t: any) => t.isWeakClose
    },
    {
      name: 'Against 50-EMA Macro Slope (Calling long when 50 EMA is sloping down, or short when sloping up)',
      fn: (t: any) => t.isEma50Opposite
    },
    {
      name: 'Whipsaw Density (>= 2 crossovers within the preceding 10 bars)',
      fn: (t: any) => t.isWhipsawDense
    },
    {
      name: 'Lagging Signal WMA Slope (WMA buffer2 slope was pointing in opposite direction at crossover)',
      fn: (t: any) => t.isB2SlopeCounter
    },
    {
      name: 'Micro-Crossover Spread (< 0.25 ATR spread between buffer1 and buffer2)',
      fn: (t: any) => t.isMicroCrossover
    },
    {
      name: 'Counter to EMA 50 Level',
      fn: (t: any) => !t.isAlignedWithEma50
    },
    {
      name: 'Counter to EMA 20 Level',
      fn: (t: any) => !t.isAlignedWithEma20
    },
    {
      name: 'Rapid Stopout <= 1 Bar',
      fn: (t: any) => t.durationBars <= 1
    },
    {
      name: 'Rapid Stopout <= 2 Bars',
      fn: (t: any) => t.durationBars <= 2
    },
    {
      name: 'COMPOUND: Whipsaw Density + Immediate Adverse Close',
      fn: (t: any) => t.isWhipsawDense && t.b1AdverseClose
    },
    {
      name: 'COMPOUND: Weak Candle Close + Counter EMA50',
      fn: (t: any) => t.isWeakClose && !t.isAlignedWithEma50
    },
    {
      name: 'COMPOUND: Bar +1 Invalidation + Whipsaw Density',
      fn: (t: any) => t.b1BrokeEntryBarInvalidation && t.isWhipsawDense
    }
  ];

  const results = checks.map(c => {
    const lHits = losses.filter(c.fn).length;
    const wHits = wins.filter(c.fn).length;
    const lPct = (lHits / losses.length) * 100;
    const wPct = (wHits / wins.length) * 100;
    const diff = lPct - wPct;
    return {
      name: c.name,
      lHits,
      wHits,
      lPct,
      wPct,
      diff
    };
  }).sort((a, b) => b.diff - a.diff);

  fs.writeFileSync('micro_patterns.json', JSON.stringify(results, null, 2));
  console.log('Saved micro_patterns.json');
}

main().catch(console.error);
