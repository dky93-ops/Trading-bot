const fs = require('fs');

let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const targetStr = `       const prevIsInside = prevRange > 0 && prev.high <= candles[i-2].high && prev.low >= candles[i-2].low;
       const isII = isInside && prevIsInside;`;

const newStr = `       const prevIsInside = prevRange > 0 && prev.high <= candles[i-2].high && prev.low >= candles[i-2].low;
       const isII = isInside && prevIsInside;

       // PDF 2: Candlestick Patterns
       const body = Math.abs(curr.close - curr.open);
       const upperShadow = curr.high - Math.max(curr.close, curr.open);
       const lowerShadow = Math.min(curr.close, curr.open) - curr.low;

       const isBullishPinBar = curr.close > curr.open && lowerShadow >= 2 * body && upperShadow < body;
       const isBearishPinBar = curr.close < curr.open && upperShadow >= 2 * body && lowerShadow < body;

       const prevBody = Math.abs(prev.close - prev.open);
       const isBullishEngulfing = prev.close < prev.open && curr.close > curr.open && curr.close >= prev.open && curr.open <= prev.close;
       const isBearishEngulfing = prev.close > prev.open && curr.close < curr.open && curr.close <= prev.open && curr.open >= prev.close;

       // PDF 1: Additional Patterns
       const isDoji = body <= range * 0.1;
       const prevIsDoji = prevBody <= prevRange * 0.1;
       const isBullishDojiSandwich = candles[i-2].close < candles[i-2].open && prevIsDoji && curr.close > curr.open;
       const isBearishDojiSandwich = candles[i-2].close > candles[i-2].open && prevIsDoji && curr.close < curr.open;
       
       const isUpthrust = curr.close < curr.open && upperShadow >= 2 * body && lowerShadow <= body * 0.5;
       const isDownthrust = curr.close > curr.open && lowerShadow >= 2 * body && upperShadow <= body * 0.5;`;

code = code.replace(targetStr, newStr);

const triggerStr = `       // II pattern setup
       if (isII) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'ii' });
       }`;

const newTriggerStr = `       // II pattern setup
       if (isII) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'ii' });
       }
       
       // Single inside bar
       if (isInside && !prevIsInside) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#9CA3AF', shape: 'circle', text: 'IB' });
       }

       // Pin Bars
       if (isBullishPinBar) {
          markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'Pin' });
          if (!ongoingTrade) {
             const entry = curr.high;
             const sl = curr.low;
             ongoingTrade = { id: \`\${curr.time}-PinBull\`, type: 'LONG', signal: 'PinBull', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry + (entry - sl)*3, status: 'OPEN' };
          }
          if (i >= candles.length - 2) {
             activeSetup = { type: 'LONG', entry: curr.high, stoploss: curr.low, target: curr.high + (curr.high - curr.low)*3 };
          }
       }
       if (isBearishPinBar) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'Pin' });
          if (!ongoingTrade) {
             const entry = curr.low;
             const sl = curr.high;
             ongoingTrade = { id: \`\${curr.time}-PinBear\`, type: 'SHORT', signal: 'PinBear', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry - (sl - entry)*3, status: 'OPEN' };
          }
          if (i >= candles.length - 2) {
             activeSetup = { type: 'SHORT', entry: curr.low, stoploss: curr.high, target: curr.low - (curr.high - curr.low)*3 };
          }
       }

       // Engulfing
       if (isBullishEngulfing) {
          markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'Engulf' });
          if (!ongoingTrade) {
             const entry = curr.high;
             const sl = prev.low < curr.low ? prev.low : curr.low;
             ongoingTrade = { id: \`\${curr.time}-EngulfBull\`, type: 'LONG', signal: 'EngulfBull', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry + (entry - sl)*2, status: 'OPEN' };
          }
          if (i >= candles.length - 2) {
             const sl = prev.low < curr.low ? prev.low : curr.low;
             activeSetup = { type: 'LONG', entry: curr.high, stoploss: sl, target: curr.high + (curr.high - sl)*2 };
          }
       }
       if (isBearishEngulfing) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'Engulf' });
          if (!ongoingTrade) {
             const entry = curr.low;
             const sl = prev.high > curr.high ? prev.high : curr.high;
             ongoingTrade = { id: \`\${curr.time}-EngulfBear\`, type: 'SHORT', signal: 'EngulfBear', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry - (sl - entry)*2, status: 'OPEN' };
          }
          if (i >= candles.length - 2) {
             const sl = prev.high > curr.high ? prev.high : curr.high;
             activeSetup = { type: 'SHORT', entry: curr.low, stoploss: sl, target: curr.low - (sl - curr.low)*2 };
          }
       }

       // Doji Sandwich
       if (isBullishDojiSandwich) {
          markers.push({ time: curr.time, position: 'belowBar', color: '#8B5CF6', shape: 'arrowUp', text: 'DS Bull' });
          if (!ongoingTrade) {
             const entry = curr.high;
             const sl = prev.low;
             ongoingTrade = { id: \`\${curr.time}-DSBull\`, type: 'LONG', signal: 'DSBull', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry + (entry - sl)*2, status: 'OPEN' };
          }
          if (i >= candles.length - 2) {
             activeSetup = { type: 'LONG', entry: curr.high, stoploss: prev.low, target: curr.high + (curr.high - prev.low)*2 };
          }
       }
       if (isBearishDojiSandwich) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#D946EF', shape: 'arrowDown', text: 'DS Bear' });
          if (!ongoingTrade) {
             const entry = curr.low;
             const sl = prev.high;
             ongoingTrade = { id: \`\${curr.time}-DSBear\`, type: 'SHORT', signal: 'DSBear', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry - (sl - entry)*2, status: 'OPEN' };
          }
          if (i >= candles.length - 2) {
             activeSetup = { type: 'SHORT', entry: curr.low, stoploss: prev.high, target: curr.low - (prev.high - curr.low)*2 };
          }
       }

       // Upthrust / Downthrust
       if (isUpthrust) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#F43F5E', shape: 'arrowDown', text: 'Upthrust' });
       }
       if (isDownthrust) {
          markers.push({ time: curr.time, position: 'belowBar', color: '#06B6D4', shape: 'arrowUp', text: 'Downthrust' });
       }`;

code = code.replace(triggerStr, newTriggerStr);
fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Added new strategies to LiveChart.tsx');
