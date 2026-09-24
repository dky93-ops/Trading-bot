const fs = require('fs');

let server = fs.readFileSync('server.ts', 'utf8');

const oldCode = `  app.get("/api/candles", async (req, res) => {
    try {
      const instrument = req.query.instrument || 'NIFTY';
      const timeframe = Number(req.query.timeframe) || 1;
      const limit = Number(req.query.limit) || 100;
      
      const { getCandles } = await import("./src/db/market.ts");
      const candles = await getCandles(instrument.toString(), timeframe, limit);
      res.json(candles);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });`;

const newCode = `  app.get("/api/candles", async (req, res) => {
    try {
      const instrument = req.query.instrument || 'NIFTY';
      const timeframe = Number(req.query.timeframe) || 1;
      const limit = Number(req.query.limit) || 100;
      
      const { getCandles } = await import("./src/db/market.ts");
      
      let rawCandles = await getCandles(instrument.toString(), 1, limit * timeframe); // Always fetch 1m candles
      
      if (timeframe === 1) {
         res.json(rawCandles);
         return;
      }
      
      // Aggregate into requested timeframe
      // rawCandles are sorted by DESC timestamp from DB
      rawCandles.reverse(); // Chronological order
      
      const aggregated = [];
      let currentCandle = null;
      let currentPeriodMs = 0;
      const periodMs = timeframe * 60 * 1000;
      
      for (const c of rawCandles) {
         const ts = new Date(c.timestamp).getTime();
         // align to period boundary (IST is UTC + 5:30. 5h30m = 330 mins = 19800000 ms)
         // Need to align boundaries to IST so that 9:15 starts properly for 5m, 15m etc.
         // Better simple boundary: 
         const boundary = Math.floor((ts + 19800000) / periodMs) * periodMs - 19800000;
         
         if (!currentCandle || boundary !== currentPeriodMs) {
            if (currentCandle) aggregated.push(currentCandle);
            currentPeriodMs = boundary;
            currentCandle = {
               timestamp: new Date(boundary).toISOString(),
               open: c.open,
               high: c.high,
               low: c.low,
               close: c.close,
               volume: c.volume
            };
         } else {
            currentCandle.high = Math.max(currentCandle.high, c.high);
            currentCandle.low = Math.min(currentCandle.low, c.low);
            currentCandle.close = c.close;
            currentCandle.volume += c.volume;
         }
      }
      if (currentCandle) aggregated.push(currentCandle);
      
      aggregated.reverse(); // Back to DESC
      res.json(aggregated.slice(0, limit));
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });`;

server = server.replace(oldCode, newCode);
fs.writeFileSync('server.ts', server);
console.log("Server API patched 2");
