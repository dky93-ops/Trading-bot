const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const newRoute = `
  app.get("/api/candles", async (req, res) => {
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
  });
`;

code = code.replace("app.get('/api/settings',", newRoute + "\n  app.get('/api/settings',");
fs.writeFileSync('server.ts', code);
console.log('patched server');
