const fs = require('fs');
let upstoxCode = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

const fetchRegex = /const price = Number\(m\.ltp \?\? m\.last_price \?\? 0\);\n\s*return \{\n\s*price,\n\s*instrumentKey: optObj\.instrument_key,\n\s*strike: targetStrike\n\s*\};/;

const fetchReplacement = `const price = Number(m.ltp ?? m.last_price ?? 0);
      return {
        price,
        instrumentKey: optObj.instrument_key,
        strike: targetStrike,
        bidPrice: Number(m.bid_price ?? 0),
        askPrice: Number(m.ask_price ?? 0),
        bidQty: Number(m.bid_qty ?? 0),
        askQty: Number(m.ask_qty ?? 0),
        volume: Number(m.volume ?? 0),
        iv: Number(optObj.option_greeks?.iv ?? 0)
      };`;

upstoxCode = upstoxCode.replace(fetchRegex, fetchReplacement);
fs.writeFileSync('src/backend/upstox-service.ts', upstoxCode);
console.log('Fixed upstox fetch replacement');
