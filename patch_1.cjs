const fs = require('fs');

// Patch types.ts
let types = fs.readFileSync('src/backend/types.ts', 'utf8');
types = types.replace(/export interface AppState \{/, "export interface AppState {\n  optionChainTimestamp: number;");
fs.writeFileSync('src/backend/types.ts', types);

// Patch upstox-service.ts
let upstox = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');
upstox = upstox.replace(/nifty50: \{\n\s*lastPrice: 0,\n\s*change: 0,\n\s*timestamp: 0\n\s*\}/, "optionChainTimestamp: 0,\n      $&");
upstox = upstox.replace(/this\.state\.nifty50\.lastPrice = spot;\n\s*this\.state\.nifty50\.timestamp = Date\.now\(\);/g, "this.state.optionChainTimestamp = Date.now();");

// Fix recordOptionChainSnapshot
const recordSnapshotRegex = /private recordOptionChainSnapshot\(rawRows: any\[\], spot: number, pcr: number, maxCallStrike: number, maxPutStrike: number, maxCallOI: number, maxPutOI: number\) \{[\s\S]*?this\.saveOptionChainHistoryToDisk\(\);\n\s*\}/m;

const newRecordSnapshot = `private recordOptionChainSnapshot(rawRows: any[], spot: number, pcr: number, maxCallStrike: number, maxPutStrike: number, maxCallOI: number, maxPutOI: number) {
    if (!rawRows || rawRows.length === 0) return;
    const instrumentKey = 'NSE_INDEX|Nifty 50';
    const expiryDate = this.settings.expiryDate;
    
    const snapshotTimestamp = Date.now();

    const snap: OptionChainSnapshot = {
      id: \`OC_\${snapshotTimestamp}\`,
      timestamp: snapshotTimestamp,
      timeISO: new Date(snapshotTimestamp).toISOString(),
      instrumentKey,
      expiryDate: expiryDate || 'CURRENT',
      spotPrice: spot,
      totalCallOI: maxCallOI,
      totalPutOI: maxPutOI,
      pcr,
      maxCallOIStrike: maxCallStrike,
      maxPutOIStrike: maxPutStrike,
      strikeCount: rawRows.length,
      rows: rawRows.map((r: any) => ({
        strike: Number(r.strike_price),
        spot: Number(r.underlying_spot_price || 0),
        ce: {
          ltp: Number(r.call_options?.market_data?.ltp || 0),
          totalOi: Number(r.call_options?.market_data?.oi || 0),
          oiChange: Number(r.call_options?.market_data?.oi_change || 0),
          volume: Number(r.call_options?.market_data?.volume || 0),
          iv: Number(r.call_options?.option_greeks?.iv || 0),
          delta: Number(r.call_options?.option_greeks?.delta || 0),
          theta: Number(r.call_options?.option_greeks?.theta || 0),
          gamma: Number(r.call_options?.option_greeks?.gamma || 0),
          vega: Number(r.call_options?.option_greeks?.vega || 0)
        },
        pe: {
          ltp: Number(r.put_options?.market_data?.ltp || 0),
          totalOi: Number(r.put_options?.market_data?.oi || 0),
          oiChange: Number(r.put_options?.market_data?.oi_change || 0),
          volume: Number(r.put_options?.market_data?.volume || 0),
          iv: Number(r.put_options?.option_greeks?.iv || 0),
          delta: Number(r.put_options?.option_greeks?.delta || 0),
          theta: Number(r.put_options?.option_greeks?.theta || 0),
          gamma: Number(r.put_options?.option_greeks?.gamma || 0),
          vega: Number(r.put_options?.option_greeks?.vega || 0)
        }
      }))
    };

    this.optionChainHistory.push(snap);
    if (this.optionChainHistory.length > 5000) {
      this.optionChainHistory.shift();
    }
    this.saveOptionChainHistoryToDisk();
  }`;

upstox = upstox.replace(recordSnapshotRegex, newRecordSnapshot);
fs.writeFileSync('src/backend/upstox-service.ts', upstox);
console.log('PATCH 1 upstox and types complete');

