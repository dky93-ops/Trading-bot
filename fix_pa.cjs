const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

code = code.replace(
  /\/\/ High 1 \/ High 2[\s\S]*?\/\/ II pattern setup/m,
  `// High 1 / High 2 / High 3 / High 4
       if (trendIsBull) {
         if (curr.high > prev.high && prev.low < candles[i-2].low) {
            if (isBullReversal || isBullTrendBar) {
              markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'H1' });
              if (i === candles.length - 1 || i === candles.length - 2) {
                const entry = curr.high;
                const sl = curr.low;
                const target = entry + (entry - sl) * 2;
                activeSetup = { type: 'LONG', entry, stoploss: sl, target };
              }
            }
         }
       }
       
       // Low 1 / Low 2 / Low 3 / Low 4
       if (trendIsBear) {
         if (curr.low < prev.low && prev.high > candles[i-2].high) {
            if (isBearReversal || isBearTrendBar) {
              markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'L1' });
              if (i === candles.length - 1 || i === candles.length - 2) {
                const entry = curr.low;
                const sl = curr.high;
                const target = entry - (sl - entry) * 2;
                activeSetup = { type: 'SHORT', entry, stoploss: sl, target };
              }
            }
         }
       }

       // Micro Double Top / Bottom
       const isMicroDB = Math.abs(curr.low - prev.low) <= range * 0.1 && isBullReversal;
       const isMicroDT = Math.abs(curr.high - prev.high) <= range * 0.1 && isBearReversal;
       if (isMicroDB) markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'MDB' });
       if (isMicroDT) markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'MDT' });

       // II pattern setup`
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed Price Action');
