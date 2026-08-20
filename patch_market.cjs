const fs = require('fs');
let code = fs.readFileSync('src/db/market.ts', 'utf8');

code = code.replace(
`    const rawCandles = candleData.map(c => {
      return {
        timestamp: new Date(c[0]),
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4]
      };
    });`,
`    const rawCandles = candleData.map(c => {
      return {
        timestamp: new Date(c[0]),
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: Number.isFinite(c[5]) ? c[5] : 0,
      };
    });`
);

code = code.replace(
`       if (!aggregated.has(bucketStartMs)) {
         aggregated.set(bucketStartMs, {
           instrument, timeframe,
           timestamp: new Date(bucketStartMs),
           open: c.open, high: c.high, low: c.low, close: c.close
         });
       } else {
         const existing = aggregated.get(bucketStartMs);
         existing.high = Math.max(existing.high, c.high);
         existing.low = Math.min(existing.low, c.low);
         existing.close = c.close;
       }`,
`       if (!aggregated.has(bucketStartMs)) {
         aggregated.set(bucketStartMs, {
           instrument, timeframe,
           timestamp: new Date(bucketStartMs),
           open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
         });
       } else {
         const existing = aggregated.get(bucketStartMs);
         existing.high = Math.max(existing.high, c.high);
         existing.low = Math.min(existing.low, c.low);
         existing.close = c.close;
         existing.volume += c.volume;
       }`
);

code = code.replace(
`      if (existing.length === 0) {
        await db.insert(candles).values(val);
      }
    }`,
`      if (existing.length === 0) {
        await db.insert(candles).values(val);
      } else {
        await db.update(candles).set({
          open: val.open,
          high: val.high,
          low: val.low,
          close: val.close,
          volume: val.volume,
        }).where(eq(candles.id, existing[0].id));
      }
    }`
);

fs.writeFileSync('src/db/market.ts', code);
