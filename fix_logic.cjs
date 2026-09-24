const fs = require('fs');

let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// The loop currently looks like:
//    for (let i = 20; i < candles.length; i++) {
//       // 1. Manage open trade
//       if (ongoingTrade) {
//          ...
//       }
//       const curr = candles[i]; ...

const oldStr = `    for (let i = 20; i < candles.length; i++) {
       // 1. Manage open trade
       if (ongoingTrade) {
         if (ongoingTrade.type === 'LONG') {
           if (curr.low <= ongoingTrade.stoploss) {
             ongoingTrade.exitPrice = ongoingTrade.stoploss;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'LOSS';
             ongoingTrade.pnl = ongoingTrade.exitPrice - ongoingTrade.entryPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           } else if (curr.high >= ongoingTrade.target) {
             ongoingTrade.exitPrice = ongoingTrade.target;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'WIN';
             ongoingTrade.pnl = ongoingTrade.exitPrice - ongoingTrade.entryPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           }
         } else { // SHORT
           if (curr.high >= ongoingTrade.stoploss) {
             ongoingTrade.exitPrice = ongoingTrade.stoploss;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'LOSS';
             ongoingTrade.pnl = ongoingTrade.entryPrice - ongoingTrade.exitPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           } else if (curr.low <= ongoingTrade.target) {
             ongoingTrade.exitPrice = ongoingTrade.target;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'WIN';
             ongoingTrade.pnl = ongoingTrade.entryPrice - ongoingTrade.exitPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           }
         }
       }`;

const newStr = `    for (let i = 20; i < candles.length; i++) {
       const curr = candles[i];
       const prev = candles[i-1];
       const ema = ema20[i].value;
       const trendIsBull = curr.close > ema;
       const trendIsBear = curr.close < ema;
       const range = curr.high - curr.low;
       const isBullTrendBar = curr.close > curr.open && (curr.close - curr.open) > range * 0.5;
       const isBearTrendBar = curr.close < curr.open && (curr.open - curr.close) > range * 0.5;
       
       // Reversal Bars
       const isBullReversal = curr.close > curr.open && (curr.close - curr.open) >= range * 0.4 && (curr.open - curr.low) > range * 0.3;
       const isBearReversal = curr.close < curr.open && (curr.open - curr.close) >= range * 0.4 && (curr.high - curr.open) > range * 0.3;

       // Inside / Outside (filter out flat 0-range candles)
       const isInside = range > 0 && curr.high <= prev.high && curr.low >= prev.low;
       const isOutside = curr.high > prev.high && curr.low < prev.low;
       
       const prevRange = prev.high - prev.low;
       const prevIsInside = prevRange > 0 && prev.high <= candles[i-2].high && prev.low >= candles[i-2].low;
       const isII = isInside && prevIsInside;

       // 1. Manage open trade
       if (ongoingTrade) {
         if (ongoingTrade.type === 'LONG') {
           if (curr.low <= ongoingTrade.stoploss) {
             ongoingTrade.exitPrice = ongoingTrade.stoploss;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'LOSS';
             ongoingTrade.pnl = ongoingTrade.exitPrice - ongoingTrade.entryPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           } else if (curr.high >= ongoingTrade.target) {
             ongoingTrade.exitPrice = ongoingTrade.target;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'WIN';
             ongoingTrade.pnl = ongoingTrade.exitPrice - ongoingTrade.entryPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           }
         } else { // SHORT
           if (curr.high >= ongoingTrade.stoploss) {
             ongoingTrade.exitPrice = ongoingTrade.stoploss;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'LOSS';
             ongoingTrade.pnl = ongoingTrade.entryPrice - ongoingTrade.exitPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           } else if (curr.low <= ongoingTrade.target) {
             ongoingTrade.exitPrice = ongoingTrade.target;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'WIN';
             ongoingTrade.pnl = ongoingTrade.entryPrice - ongoingTrade.exitPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           }
         }
       }`;

code = code.replace(oldStr, newStr);

// Then remove the old const definitions which are further down
const removeStr = `       const curr = candles[i];
       const prev = candles[i-1];
       const ema = ema20[i].value;
       const trendIsBull = curr.close > ema;
       const trendIsBear = curr.close < ema;
       const range = curr.high - curr.low;
       const isBullTrendBar = curr.close > curr.open && (curr.close - curr.open) > range * 0.5;
       const isBearTrendBar = curr.close < curr.open && (curr.open - curr.close) > range * 0.5;
       
       // Reversal Bars
       const isBullReversal = curr.close > curr.open && (curr.close - curr.open) >= range * 0.4 && (curr.open - curr.low) > range * 0.3;
       const isBearReversal = curr.close < curr.open && (curr.open - curr.close) >= range * 0.4 && (curr.high - curr.open) > range * 0.3;

       // Inside / Outside (filter out flat 0-range candles)
       const isInside = range > 0 && curr.high <= prev.high && curr.low >= prev.low;
       const isOutside = curr.high > prev.high && curr.low < prev.low;
       
       const prevRange = prev.high - prev.low;
       const prevIsInside = prevRange > 0 && prev.high <= candles[i-2].high && prev.low >= candles[i-2].low;
       const isII = isInside && prevIsInside;`;

code = code.replace(removeStr, '');

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed variable scope');
