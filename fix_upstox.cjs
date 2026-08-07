const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// Remove BankNifty from state initialization
code = code.replace(/bankNifty: \{ lastPrice: 0, change: 0, timestamp: 0 \},/g, '');

// Remove BankNifty references in onMessage
code = code.replace(/if \(data\['NSE_INDEX:Nifty Bank'\]\) \{[\s\S]*?if \(this\.strategyEngine\.isMarketOpen\(\)\) \{\s*insertTick\('BANKNIFTY', tick\.last_price, Date\.now\(\)\);\s*\}\s*\}/g, '');
code = code.replace(/const wsUrl = `wss:\/\/api\.upstox\.com\/v2\/feed\/market-data-feed\?instrument_tokens=\$\{encodeURIComponent\('NSE_INDEX\|Nifty 50,NSE_INDEX\|Nifty Bank,NSE_INDEX\|India VIX'\)\}`;/g, 
  "const wsUrl = `wss://api.upstox.com/v2/feed/market-data-feed?instrument_tokens=${encodeURIComponent('NSE_INDEX|Nifty 50,NSE_INDEX|India VIX')}`;");
code = code.replace(/const instrumentKeys = 'NSE_INDEX\|Nifty 50,NSE_INDEX\|Nifty Bank,NSE_INDEX\|India VIX';/g, 
  "const instrumentKeys = 'NSE_INDEX|Nifty 50,NSE_INDEX|India VIX';");


// In recordOptionChainSnapshot, add the new Greeks.
// It maps `ce` and `pe` to `price`, `oi`, `oiChange`, `volume`, `iv`. We need to change this to `ltp`, `totalOi`...
// and add delta, theta, gamma, vega.
code = code.replace(/ce: \{\s*price: r\.call_options\?\.market_data\?\.ltp \|\| 0,\s*oi: r\.call_options\?\.market_data\?\.oi \|\| 0,\s*oiChange: r\.call_options\?\.market_data\?\.oi_change \|\| 0,\s*volume: r\.call_options\?\.market_data\?\.volume \|\| 0,\s*iv: r\.call_options\?\.option_greeks\?\.iv \|\| 0\s*\}/g,
`ce: {
              ltp: r.call_options?.market_data?.ltp || 0,
              totalOi: r.call_options?.market_data?.oi || 0,
              oiChange: r.call_options?.market_data?.oi_change || 0,
              volume: r.call_options?.market_data?.volume || 0,
              iv: r.call_options?.option_greeks?.iv || 0,
              delta: r.call_options?.option_greeks?.delta || 0,
              theta: r.call_options?.option_greeks?.theta || 0,
              gamma: r.call_options?.option_greeks?.gamma || 0,
              vega: r.call_options?.option_greeks?.vega || 0
            }`);

code = code.replace(/pe: \{\s*price: r\.put_options\?\.market_data\?\.ltp \|\| 0,\s*oi: r\.put_options\?\.market_data\?\.oi \|\| 0,\s*oiChange: r\.put_options\?\.market_data\?\.oi_change \|\| 0,\s*volume: r\.put_options\?\.market_data\?\.volume \|\| 0,\s*iv: r\.put_options\?\.option_greeks\?\.iv \|\| 0\s*\}/g,
`pe: {
              ltp: r.put_options?.market_data?.ltp || 0,
              totalOi: r.put_options?.market_data?.oi || 0,
              oiChange: r.put_options?.market_data?.oi_change || 0,
              volume: r.put_options?.market_data?.volume || 0,
              iv: r.put_options?.option_greeks?.iv || 0,
              delta: r.put_options?.option_greeks?.delta || 0,
              theta: r.put_options?.option_greeks?.theta || 0,
              gamma: r.put_options?.option_greeks?.gamma || 0,
              vega: r.put_options?.option_greeks?.vega || 0
            }`);

fs.writeFileSync('src/backend/upstox-service.ts', code);
