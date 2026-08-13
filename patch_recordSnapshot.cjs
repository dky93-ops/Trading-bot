const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

const oldRowsMap = `rows: rawRows.map((r: any) => ({
            strike: r.strike_price,
            spot: r.underlying_spot_price,
            ce: {
              ltp: r.call_options?.market_data?.ltp || 0,
              totalOi: r.call_options?.market_data?.oi || 0,
              oiChange: r.call_options?.market_data?.oi_change || 0,
              volume: r.call_options?.market_data?.volume || 0,
              iv: r.call_options?.option_greeks?.iv || 0,
              delta: r.call_options?.option_greeks?.delta || 0,
              theta: r.call_options?.option_greeks?.theta || 0,
              gamma: r.call_options?.option_greeks?.gamma || 0,
              vega: r.call_options?.option_greeks?.vega || 0
            },
            pe: {
              ltp: r.put_options?.market_data?.ltp || 0,
              totalOi: r.put_options?.market_data?.oi || 0,
              oiChange: r.put_options?.market_data?.oi_change || 0,
              volume: r.put_options?.market_data?.volume || 0,
              iv: r.put_options?.option_greeks?.iv || 0,
              delta: r.put_options?.option_greeks?.delta || 0,
              theta: r.put_options?.option_greeks?.theta || 0,
              gamma: r.put_options?.option_greeks?.gamma || 0,
              vega: r.put_options?.option_greeks?.vega || 0
            }
          }))`;

const newFiniteNumber = `const finiteNumber = (value: unknown): number | undefined => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };
    const makeOption = (raw: any) => {
      const md = raw?.market_data || {};
      const greeks = raw?.option_greeks || {};
      return {
        ltp: finiteNumber(md.ltp ?? md.last_price),
        bid: finiteNumber(md.bid_price),
        ask: finiteNumber(md.ask_price),
        totalOi: finiteNumber(md.oi ?? md.total_oi ?? md.totalOi),
        oiChange: finiteNumber(md.oi_change ?? md.oiChange),
        volume: finiteNumber(md.volume),
        iv: finiteNumber(greeks.iv),
        delta: finiteNumber(greeks.delta),
        theta: finiteNumber(greeks.theta),
        gamma: finiteNumber(greeks.gamma),
        vega: finiteNumber(greeks.vega),
        instrumentKey: String(raw?.instrument_key || ''),
      };
    };`;

code = code.replace(
  "  private recordOptionChainSnapshot(instrumentKey: string, expiryDate: string, rawRows: any[]) {",
  "  private recordOptionChainSnapshot(instrumentKey: string, expiryDate: string, rawRows: any[]) {\n    " + newFiniteNumber
);

const newRowsMap = `rows: rawRows.map((r: any) => ({
            strike: r.strike_price,
            spot: r.underlying_spot_price,
            ce: makeOption(r.call_options),
            pe: makeOption(r.put_options)
          }))`;

code = code.replace(oldRowsMap, newRowsMap);

fs.writeFileSync('src/backend/upstox-service.ts', code);
console.log('Patched recordOptionChainSnapshot');
