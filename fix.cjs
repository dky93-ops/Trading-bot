const fs = require('fs');
let content = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// replace rows mapping
const oldMapping = `        const snap: OptionChainSnapshot = {
          id: \`OC_1M_\${nowMs}\`,
          timestamp: nowMs,
          timeISO: new Date(nowMs).toISOString(),
          instrumentKey,
          expiryDate: expiryDate || 'CURRENT',
          spotPrice: spot,
          totalCallOI,
          totalPutOI,
          pcr,
          maxCallOIStrike: maxCallStrike,
          maxPutOIStrike: maxPutStrike,
          strikeCount: rawRows.length,
          indexCandles,
          ceWalls,
          peWalls,
          rows: rawRows.map((r: any) => ({
            strike: r.strike_price,
            spot: r.underlying_spot_price,
            ce: makeOption(r.call_options),
            pe: makeOption(r.put_options)
          }))
        };`;

const newMapping = `        let atmStrike = 0;
        let minDiff = Infinity;
        for (const r of rawRows) {
          const diff = Math.abs(r.strike_price - spot);
          if (diff < minDiff) {
            minDiff = diff;
            atmStrike = r.strike_price;
          }
        }
        const atmIndex = rawRows.findIndex((r: any) => r.strike_price === atmStrike);
        let filteredRows = rawRows;
        if (atmIndex !== -1) {
          const startIndex = Math.max(0, atmIndex - 12);
          const endIndex = Math.min(rawRows.length - 1, atmIndex + 12);
          filteredRows = rawRows.slice(startIndex, endIndex + 1);
        }

        const snap: OptionChainSnapshot = {
          id: \`OC_1M_\${nowMs}\`,
          timestamp: nowMs,
          timeISO: new Date(nowMs).toISOString(),
          instrumentKey,
          expiryDate: expiryDate || 'CURRENT',
          spotPrice: spot,
          totalCallOI,
          totalPutOI,
          pcr,
          maxCallOIStrike: maxCallStrike,
          maxPutOIStrike: maxPutStrike,
          strikeCount: filteredRows.length,
          indexCandles,
          ceWalls,
          peWalls,
          rows: filteredRows.map((r: any) => ({
            strike: r.strike_price,
            spot: r.underlying_spot_price,
            ce: makeOption(r.call_options),
            pe: makeOption(r.put_options)
          }))
        };`;

if (content.includes("strikeCount: rawRows.length,")) {
  content = content.replace(oldMapping, newMapping);
  fs.writeFileSync('src/backend/upstox-service.ts', content);
  console.log("Replaced backend successfully.");
} else {
  console.log("Could not find old mapping in upstox-service.ts");
}
