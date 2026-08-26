const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf-8');

const regex = /const response = await axios\.get\([\s\S]*?await seedHistoricalCandles\('NIFTY', 15, rawCandles\);\s*}/;

const newLogic = `
      // Fetch exactly 1-minute candles for the strategy engine
      const response1m = await axios.get(
        \`https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/1\`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: \`Bearer \${this.settings.accessToken}\`,
          },
          timeout: 5000,
        },
      );
      if (response1m.data && response1m.data.status === 'success' && response1m.data.data && response1m.data.data.candles) {
        const rawCandles1m = response1m.data.data.candles;
        await seedHistoricalCandles('NIFTY', 1, rawCandles1m);
      }
      
      // Fetch decision timeframe candles if > 1
      if (decisionMinutes > 1) {
          const responseDt = await axios.get(
            \`https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/\${decisionMinutes}\`,
            {
              headers: {
                Accept: 'application/json',
                Authorization: \`Bearer \${this.settings.accessToken}\`,
              },
              timeout: 5000,
            },
          );
          if (responseDt.data && responseDt.data.status === 'success' && responseDt.data.data && responseDt.data.data.candles) {
            await seedHistoricalCandles('NIFTY', decisionMinutes, responseDt.data.data.candles);
          }
      }`;

code = code.replace(regex, newLogic);
fs.writeFileSync('src/backend/upstox-service.ts', code);
console.log('Patched syncHistoricalCandles');
