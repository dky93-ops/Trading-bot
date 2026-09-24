const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const replacement = `const applyPriceActionAnalysis = (candles: any[], series: ISeriesApi<"Candlestick">, emaSeries: ISeriesApi<"Line">, activeStrategies = strategies) => {
    if (candles.length < 50) return;
    
    // Core Indicators
    const closePrices = candles.map(c => c.close);
    const highPrices = candles.map(c => c.high);
    const lowPrices = candles.map(c => c.low);
    
    const ema20 = calculateEMA(candles, 20);
    emaSeries.setData(ema20);

    const rsi14 = computeRSI(closePrices, 14);
    const atr14 = computeATR(highPrices, lowPrices, closePrices, 14);
    const ema9 = computeEMA(closePrices, 9);
    const ema21 = computeEMA(closePrices, 21);
    const { macdLine, signalLine } = computeMACD(closePrices, 12, 26, 9);
    const { upper, lower } = computeBollinger(closePrices, 20, 2.0);
    const { direction: superTrendDir } = computeSuperTrend(highPrices, lowPrices, closePrices, 10, 3.0);
    
    priceLinesRef.current.forEach(line => series.removePriceLine(line));
    priceLinesRef.current = [];
    let markers: any[] = [];
    
    // Classic Support / Resistance
    if (activeStrategies.classicSR) {
      const pivotHighs: any[] = [];
      const pivotLows: any[] = [];
      const PIVOT_LEN = 15;
      for (let i = PIVOT_LEN; i < candles.length - PIVOT_LEN; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = 1; j <= PIVOT_LEN; j++) {
          if (candles[i-j].high > candles[i].high) isHigh = false;
          if (candles[i-j].low < candles[i].low) isLow = false;
          if (candles[i+j].high > candles[i].high) isHigh = false;
          if (candles[i+j].low < candles[i].low) isLow = false;
        }
        if (isHigh) pivotHighs.push({ time: candles[i].time, price: candles[i].high });
        if (isLow) pivotLows.push({ time: candles[i].time, price: candles[i].low });
      }

      pivotHighs.slice(-3).forEach(ph => {
        const line = series.createPriceLine({ price: ph.price, color: '#EF4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Res' });
        priceLinesRef.current.push(line);
      });
      pivotLows.slice(-3).forEach(pl => {
        const line = series.createPriceLine({ price: pl.price, color: '#10B981', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Sup' });
        priceLinesRef.current.push(line);
      });
    }
    
    const allTrades: Trade[] = [];
    // We allow tracking multiple open trades (e.g. from different strategies)
    const openTrades: Trade[] = [];

    // Loop through candles
    for (let i = 50; i < candles.length; i++) {
       const curr = candles[i];
       const prev = candles[i-1];
       const range = curr.high - curr.low;
       const body = Math.abs(curr.close - curr.open);
       const atr = atr14[i] || Math.max(range, 1); // fallback to range if ATR not available
       
       // --- Manage Open Trades for current bar ---
       for (let j = openTrades.length - 1; j >= 0; j--) {
         const t = openTrades[j];
         if (t.type === 'LONG') {
           if (curr.low <= t.stoploss) {
             t.exitPrice = t.stoploss;
             t.exitTime = curr.time as number;
             t.status = 'LOSS';
             t.pnl = t.exitPrice - t.entryPrice;
             openTrades.splice(j, 1);
           } else if (curr.high >= t.target) {
             t.exitPrice = t.target;
             t.exitTime = curr.time as number;
             t.status = 'WIN';
             t.pnl = t.exitPrice - t.entryPrice;
             openTrades.splice(j, 1);
           }
         } else { // SHORT
           if (curr.high >= t.stoploss) {
             t.exitPrice = t.stoploss;
             t.exitTime = curr.time as number;
             t.status = 'LOSS';
             t.pnl = t.entryPrice - t.exitPrice;
             openTrades.splice(j, 1);
           } else if (curr.low <= t.target) {
             t.exitPrice = t.target;
             t.exitTime = curr.time as number;
             t.status = 'WIN';
             t.pnl = t.entryPrice - t.exitPrice;
             openTrades.splice(j, 1);
           }
         }
       }
       
       // --- Strategy Execution ---
       
       // Helper to open trades
       const openTrade = (type: 'LONG'|'SHORT', signalName: string, slPoints: number, tpPoints: number) => {
         // Don't open if we already have an open trade for this signal to avoid spam
         if (openTrades.some(t => t.signal === signalName)) return;
         
         const entry = type === 'LONG' ? curr.high : curr.low;
         const sl = type === 'LONG' ? entry - slPoints : entry + slPoints;
         const target = type === 'LONG' ? entry + tpPoints : entry - tpPoints;
         
         const newTrade: Trade = {
           id: \`\${curr.time}-\${signalName}\`,
           type,
           signal: signalName,
           entryTime: curr.time as number,
           entryPrice: entry,
           stoploss: sl,
           target,
           status: 'OPEN'
         };
         openTrades.push(newTrade);
         allTrades.push(newTrade);
       };

       // 1. Consensus Strategy
       if (activeStrategies.consensus) {
         let buyVotes = 0;
         let sellVotes = 0;
         
         // Vote 1: EMA Crossover
         if (ema9[i] > ema21[i]) buyVotes++;
         else sellVotes++;
         
         // Vote 2: MACD
         if (macdLine[i] > signalLine[i]) buyVotes++;
         else sellVotes++;
         
         // Vote 3: RSI
         if (rsi14[i] < 30) buyVotes++;
         else if (rsi14[i] > 70) sellVotes++;
         
         // Vote 4: Bollinger Bands
         if (curr.close < lower[i]) buyVotes++;
         else if (curr.close > upper[i]) sellVotes++;
         
         // Vote 5: SuperTrend
         if (superTrendDir[i] === 1) buyVotes++; // assuming 1 = uptrend in our calc
         else sellVotes++;
         
         if (buyVotes >= 4) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'Consensus' });
           openTrade('LONG', 'Consensus', atr * 1.5, atr * 2.5);
         } else if (sellVotes >= 4) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'Consensus' });
           openTrade('SHORT', 'Consensus', atr * 1.5, atr * 2.5);
         }
       }
       
       // 2. Al Brooks Price Action
       if (activeStrategies.alBrooks) {
         const ema = ema20[i].value;
         const trendIsBull = curr.close > ema;
         const trendIsBear = curr.close < ema;
         const isBullTrendBar = curr.close > curr.open && (curr.close - curr.open) > range * 0.5;
         const isBearTrendBar = curr.close < curr.open && (curr.open - curr.close) > range * 0.5;
         const isBullReversal = curr.close > curr.open && (curr.close - curr.open) >= range * 0.4 && (curr.open - curr.low) > range * 0.3;
         const isBearReversal = curr.close < curr.open && (curr.open - curr.close) >= range * 0.4 && (curr.high - curr.open) > range * 0.3;
         
         // High 1 / Low 1 logic
         if (trendIsBull && curr.high > prev.high && prev.low < candles[i-2].low) {
           if (isBullReversal || isBullTrendBar) {
              markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'H1' });
              openTrade('LONG', 'H1', range, range * 2);
           }
         }
         if (trendIsBear && curr.low < prev.low && prev.high > candles[i-2].high) {
           if (isBearReversal || isBearTrendBar) {
              markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'L1' });
              openTrade('SHORT', 'L1', range, range * 2);
           }
         }
         
         // Micro Double Top / Bottom
         const isMicroDB = Math.abs(curr.low - prev.low) <= range * 0.1 && isBullReversal;
         const isMicroDT = Math.abs(curr.high - prev.high) <= range * 0.1 && isBearReversal;
         if (isMicroDB) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'MDB' });
           openTrade('LONG', 'MDB', range, range * 2);
         }
         if (isMicroDT) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'MDT' });
           openTrade('SHORT', 'MDT', range, range * 2);
         }
         
         // Inside bars
         const isInside = range > 0 && curr.high <= prev.high && curr.low >= prev.low;
         const prevRange = prev.high - prev.low;
         const prevIsInside = prevRange > 0 && prev.high <= candles[i-2].high && prev.low >= candles[i-2].low;
         if (isInside && prevIsInside) markers.push({ time: curr.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'ii' });
         else if (isInside) markers.push({ time: curr.time, position: 'aboveBar', color: '#9CA3AF', shape: 'circle', text: 'IB' });
         
         // Pin bars
         const upperShadow = curr.high - Math.max(curr.close, curr.open);
         const lowerShadow = Math.min(curr.close, curr.open) - curr.low;
         const isBullishPinBar = curr.close > curr.open && lowerShadow >= 2 * body && upperShadow < body;
         const isBearishPinBar = curr.close < curr.open && upperShadow >= 2 * body && lowerShadow < body;
         if (isBullishPinBar) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'Pin' });
           openTrade('LONG', 'PinBull', range, range * 3);
         }
         if (isBearishPinBar) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'Pin' });
           openTrade('SHORT', 'PinBear', range, range * 3);
         }
         
         // Engulfing
         const isBullishEngulfing = prev.close < prev.open && curr.close > curr.open && curr.close >= prev.open && curr.open <= prev.close;
         const isBearishEngulfing = prev.close > prev.open && curr.close < curr.open && curr.close <= prev.open && curr.open >= prev.close;
         if (isBullishEngulfing) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'Engulf' });
           openTrade('LONG', 'EngulfBull', range, range * 2);
         }
         if (isBearishEngulfing) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'Engulf' });
           openTrade('SHORT', 'EngulfBear', range, range * 2);
         }
         
         // Doji Sandwich
         const isDoji = body <= range * 0.1;
         const prevBody = Math.abs(prev.close - prev.open);
         const prevIsDoji = prevBody <= prevRange * 0.1;
         const isBullishDojiSandwich = candles[i-2].close < candles[i-2].open && prevIsDoji && curr.close > curr.open;
         const isBearishDojiSandwich = candles[i-2].close > candles[i-2].open && prevIsDoji && curr.close < curr.open;
         if (isBullishDojiSandwich) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#8B5CF6', shape: 'arrowUp', text: 'DS Bull' });
           openTrade('LONG', 'DSBull', range, range * 2);
         }
         if (isBearishDojiSandwich) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#D946EF', shape: 'arrowDown', text: 'DS Bear' });
           openTrade('SHORT', 'DSBear', range, range * 2);
         }
         
         // Upthrust/Downthrust
         const isUpthrust = curr.close < curr.open && upperShadow >= 2 * body && lowerShadow <= body * 0.5;
         const isDownthrust = curr.close > curr.open && lowerShadow >= 2 * body && upperShadow <= body * 0.5;
         if (isUpthrust) markers.push({ time: curr.time, position: 'aboveBar', color: '#F43F5E', shape: 'arrowDown', text: 'Upthrust' });
         if (isDownthrust) markers.push({ time: curr.time, position: 'belowBar', color: '#06B6D4', shape: 'arrowUp', text: 'Downthrust' });
       }
       
       // 3. EMA Scalping
       if (activeStrategies.scalping) {
         const ema = ema20[i].value;
         const range = curr.high - curr.low;
         const isBullTrendBar = curr.close > curr.open && (curr.close - curr.open) > range * 0.5;
         const isBearTrendBar = curr.close < curr.open && (curr.open - curr.close) > range * 0.5;
         
         const isScalpBull = isBullTrendBar && curr.close > ema && prev.close <= ema20[i-1].value;
         const isScalpBear = isBearTrendBar && curr.close < ema && prev.close >= ema20[i-1].value;
         
         if (isScalpBull) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#0EA5E9', shape: 'arrowUp', text: 'Scalp' });
           openTrade('LONG', 'ScalpBull', range, range * 1.5);
         }
         if (isScalpBear) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#EAB308', shape: 'arrowDown', text: 'Scalp' });
           openTrade('SHORT', 'ScalpBear', range, range * 1.5);
         }
       }
       
       // 4. MBEE Breakout
       if (activeStrategies.mbee) {
         const recentCandles = candles.slice(i-5, i);
         const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / 5;
         const isBuildup = avgRange < (ema20[i].value * 0.001); // tight consolidation
            
         const isMBEEBull = isBuildup && curr.close > Math.max(...recentCandles.map(c => c.high));
         const isMBEEBear = isBuildup && curr.close < Math.min(...recentCandles.map(c => c.low));
         if (isMBEEBull) {
            markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'MBEE Brk' });
            openTrade('LONG', 'MBEEBull', atr, atr * 2);
         }
         if (isMBEEBear) {
            markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'MBEE Brk' });
            openTrade('SHORT', 'MBEEBear', atr, atr * 2);
         }
       }
       
       // 5. Candlestick Patterns
       if (activeStrategies.candlesticks) {
         const range = curr.high - curr.low;
         const body = Math.abs(curr.close - curr.open);
         const upperShadow = curr.high - Math.max(curr.close, curr.open);
         const lowerShadow = Math.min(curr.close, curr.open) - curr.low;
         const isHammer = upperShadow <= range * 0.1 && curr.close >= curr.low + range * 0.75 && lowerShadow >= 2 * body;
         const isShootingStar = lowerShadow <= range * 0.1 && curr.close <= curr.low + range * 0.25 && upperShadow >= 2 * body;
         
         if (isHammer) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'Hammer' });
           openTrade('LONG', 'Hammer', range, range * 2);
         }
         if (isShootingStar) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'SStar' });
           openTrade('SHORT', 'SStar', range, range * 2);
         }
         
         const prevMidpoint = (prev.open + prev.close) / 2;
         const isPiercing = prev.close < prev.open && curr.close > curr.open && curr.close > prevMidpoint && curr.close < prev.open;
         const isDarkCloudCover = prev.close > prev.open && curr.close < curr.open && curr.close < prevMidpoint && curr.close > prev.open;
         
         if (isPiercing) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'Piercing' });
           openTrade('LONG', 'Piercing', range, range * 2);
         }
         if (isDarkCloudCover) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'Cloud' });
           openTrade('SHORT', 'Cloud', range, range * 2);
         }
         
         const prevBody = Math.abs(prev.close - prev.open);
         const prevLowerShadow = Math.min(prev.close, prev.open) - prev.low;
         const prevUpperShadow = prev.high - Math.max(prev.close, prev.open);
         const isTweezerBottom = prevLowerShadow > prevBody && Math.abs(curr.low - prev.low) <= range * 0.1 && curr.close > curr.open;
         const isTweezerTop = prevUpperShadow > prevBody && Math.abs(curr.high - prev.high) <= range * 0.1 && curr.close < curr.open;
         
         if (isTweezerBottom) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'TwzBtm' });
           openTrade('LONG', 'TwzBtm', range, range * 2);
         }
         if (isTweezerTop) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'TwzTop' });
           openTrade('SHORT', 'TwzTop', range, range * 2);
         }
         
         const prev2 = candles[i-2];
         const prevRange = prev.high - prev.low;
         const prev2Body = Math.abs(prev2.close - prev2.open);
         const prev2Midpoint = (prev2.open + prev2.close) / 2;
         const isMorningStar = prev2.close < prev2.open && prevRange <= prev2Body * 0.5 && curr.close > curr.open && curr.close > prev2Midpoint;
         const isEveningStar = prev2.close > prev2.open && prevRange <= prev2Body * 0.5 && curr.close < curr.open && curr.close < prev2Midpoint;
         
         if (isMorningStar) {
           markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'MStar' });
           openTrade('LONG', 'MStar', range, range * 2);
         }
         if (isEveningStar) {
           markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'EStar' });
           openTrade('SHORT', 'EStar', range, range * 2);
         }
       }
    }

    series.setMarkers(markers);
    setBacktestTrades([...allTrades].reverse());
  };`;

// Find the start and end of applyPriceActionAnalysis to replace it
let startIdx = code.indexOf('const applyPriceActionAnalysis = (candles: any[], series: ISeriesApi<"Candlestick">, emaSeries: ISeriesApi<"Line">, activeStrategies = strategies) => {');
if (startIdx === -1) {
  startIdx = code.indexOf('const applyPriceActionAnalysis = (candles: any[], series: ISeriesApi<"Candlestick">, emaSeries: ISeriesApi<"Line">) => {');
}

let endStr = 'setBacktestTrades([...completedTrades]);\n  };';
let endIdx = code.indexOf(endStr);
if (endIdx === -1) {
  endStr = 'setBacktestTrades([...completedTrades].reverse());\n  };';
  endIdx = code.indexOf(endStr);
}
if (endIdx === -1) {
  endStr = 'setBacktestTrades([...allTrades].reverse());\n  };';
  endIdx = code.indexOf(endStr);
}
if (endIdx === -1) {
  // Let's do a substring match from `const applyPriceActionAnalysis` up to `setBacktestTrades`
  console.log("Could not find end string.");
  let setBack = code.indexOf('setBacktestTrades(', startIdx);
  let closing = code.indexOf('};', setBack);
  endIdx = closing - endStr.length; // rough
  if (setBack !== -1 && closing !== -1) {
     endStr = code.substring(setBack, closing + 2);
     endIdx = setBack;
  }
}

if (startIdx !== -1 && endIdx !== -1) {
  let newCode = code.substring(0, startIdx) + replacement + code.substring(endIdx + endStr.length);
  fs.writeFileSync('src/components/LiveChart.tsx', newCode);
  console.log('Replaced applyPriceActionAnalysis');
} else {
  console.log('Failed to replace', startIdx, endIdx);
}
