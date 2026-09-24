const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const mdbOld = `       if (isMicroDB) {
          markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'MDB' });
          if (!ongoingTrade) {
             const entry = curr.high;
             const sl = curr.low;
             ongoingTrade = { id: \`\${curr.time}-MDB\`, type: 'LONG', signal: 'MDB', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry + (entry - sl)*2, status: 'OPEN' };
          }
       }`;

const mdbNew = `       if (isMicroDB) {
          markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'MDB' });
          if (!ongoingTrade) {
             const entry = curr.high;
             const sl = curr.low;
             ongoingTrade = { id: \`\${curr.time}-MDB\`, type: 'LONG', signal: 'MDB', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry + (entry - sl)*2, status: 'OPEN' };
          }
          if (i >= candles.length - 2) {
             const entry = curr.high;
             const sl = curr.low;
             activeSetup = { type: 'LONG', entry, stoploss: sl, target: entry + (entry - sl)*2 };
          }
       }`;

const mdtOld = `       if (isMicroDT) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'MDT' });
          if (!ongoingTrade) {
             const entry = curr.low;
             const sl = curr.high;
             ongoingTrade = { id: \`\${curr.time}-MDT\`, type: 'SHORT', signal: 'MDT', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry - (sl - entry)*2, status: 'OPEN' };
          }
       }`;

const mdtNew = `       if (isMicroDT) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'MDT' });
          if (!ongoingTrade) {
             const entry = curr.low;
             const sl = curr.high;
             ongoingTrade = { id: \`\${curr.time}-MDT\`, type: 'SHORT', signal: 'MDT', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry - (sl - entry)*2, status: 'OPEN' };
          }
          if (i >= candles.length - 2) {
             const entry = curr.low;
             const sl = curr.high;
             activeSetup = { type: 'SHORT', entry, stoploss: sl, target: entry - (sl - entry)*2 };
          }
       }`;

code = code.replace(mdbOld, mdbNew);
code = code.replace(mdtOld, mdtNew);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed activeSetup for MDT/MDB');
