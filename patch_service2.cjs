const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// Replace the 5minute URL with 1minute and timeframe argument
const oldMethod = "const response = await axios.get('https://api.upstox.com/v2/historical-candle/intraday/NSE_INDEX%7CNifty%2050/5minute'";
const newMethod = "const response = await axios.get('https://api.upstox.com/v2/historical-candle/intraday/NSE_INDEX%7CNifty%2050/1minute'";
code = code.replace(oldMethod, newMethod);

// Replace the call to seedHistoricalCandles
code = code.replace("await seedHistoricalCandles('NIFTY', 5, response.data.data.candles.reverse());", 
`await seedHistoricalCandles('NIFTY', 5, response.data.data.candles);
        await seedHistoricalCandles('NIFTY', 1, response.data.data.candles);
        await seedHistoricalCandles('NIFTY', 3, response.data.data.candles);`);

fs.writeFileSync('src/backend/upstox-service.ts', code);
