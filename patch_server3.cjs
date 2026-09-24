const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

const oldCode = `      let rawCandles = await getCandles(instrument.toString(), 1, limit * timeframe); // Always fetch 1m candles`;
const newCode = `      // Fetch excess candles to account for out-of-market hour filtering
      let rawCandles = await getCandles(instrument.toString(), 1, limit * timeframe * 10);
      
      // Filter strictly for IST market hours (09:15 to 15:30)
      rawCandles = rawCandles.filter(c => {
           const d = new Date(c.timestamp);
           const istTime = new Date(d.getTime() + 19800000);
           const hh = istTime.getUTCHours();
           const mm = istTime.getUTCMinutes();
           const timeNum = hh * 100 + mm;
           return timeNum >= 915 && timeNum <= 1530;
      });
      // Limit to the exactly requested number
      rawCandles = rawCandles.slice(0, limit * timeframe);
`;

server = server.replace(oldCode, newCode);
fs.writeFileSync('server.ts', server);
console.log("Server API patched 3");
