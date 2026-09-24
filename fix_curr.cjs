const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const oldStr = `       // 1. Manage open trade
       if (ongoingTrade) {`;

const newStr = `       const curr = candles[i];
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
       if (ongoingTrade) {`;

code = code.replace(oldStr, newStr);

const removeRegex = /       const curr = candles\[i\];[\s\S]*?const isII = isInside && prevIsInside;/g;

// Find all matches
const matches = [...code.matchAll(removeRegex)];
if (matches.length > 1) {
  // We want to remove the SECOND match which is now the original one.
  const secondMatchIndex = matches[1].index;
  const secondMatchLength = matches[1][0].length;
  code = code.substring(0, secondMatchIndex) + code.substring(secondMatchIndex + secondMatchLength);
}

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed variable scope.');
