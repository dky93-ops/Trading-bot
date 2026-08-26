const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

const oldSelectStrike = `  private selectStrike(direction: 'CALL' | 'PUT', spot: number, chainRows: any[]) {
    let closestRow = chainRows[0];
    let minDiff = Infinity;
    for (const row of chainRows) {
        const diff = Math.abs(Number(row.strike_price) - spot);
        if (diff < minDiff) {
            minDiff = diff;
            closestRow = row;
        }
    }
    if (!closestRow) return undefined;
    const opt = direction === 'CALL' ? closestRow.call_options : closestRow.put_options;
    if (!opt) return undefined;
    
    return {
        strike: Number(closestRow.strike_price),
        price: Number(opt.market_data?.ltp || opt.market_data?.last_price || 0),
        bidPrice: Number(opt.market_data?.bid_price || opt.market_data?.bid || 0),
        askPrice: Number(opt.market_data?.ask_price || opt.market_data?.ask || 0),
        instrumentKey: opt.instrument_key || ''
    };
  }`;

const newSelectStrike = `  private selectStrike(direction: 'CALL' | 'PUT', spot: number, chainRows: any[]) {
    // 3. Option Strike Selection (Moneyness Bands)
    // Find ATM
    let atmIndex = -1;
    let minDiff = Infinity;
    for (let i = 0; i < chainRows.length; i++) {
        const diff = Math.abs(Number(chainRows[i].strike_price) - spot);
        if (diff < minDiff) {
            minDiff = diff;
            atmIndex = i;
        }
    }
    
    if (atmIndex === -1) return undefined;
    
    // Allowed strikes: ATM, and 1 ITM.
    // For CALL, ITM is a lower strike price (usually lower index if sorted ascending).
    // For PUT, ITM is a higher strike price (usually higher index if sorted ascending).
    // Let's ensure chainRows is sorted just in case
    const sorted = [...chainRows].sort((a,b) => Number(a.strike_price) - Number(b.strike_price));
    let newAtmIndex = sorted.findIndex(r => Math.abs(Number(r.strike_price) - spot) === minDiff);
    
    let allowedRows = [];
    if (newAtmIndex !== -1) {
      allowedRows.push(sorted[newAtmIndex]); // ATM
      if (direction === 'CALL' && newAtmIndex > 0) {
         allowedRows.push(sorted[newAtmIndex - 1]); // 1 ITM (lower strike)
      } else if (direction === 'PUT' && newAtmIndex < sorted.length - 1) {
         allowedRows.push(sorted[newAtmIndex + 1]); // 1 ITM (higher strike)
      }
    }
    
    let bestOption = null;
    let bestSpread = Infinity;
    const maxSpread = Number(this.settings.MAX_OPTION_SPREAD_PERCENT || 1.5);
    
    for (const row of allowedRows) {
      const opt = direction === 'CALL' ? row.call_options : row.put_options;
      if (!opt) continue;
      
      const price = Number(opt.market_data?.ltp || opt.market_data?.last_price || 0);
      const bidPrice = Number(opt.market_data?.bid_price || opt.market_data?.bid || 0);
      const askPrice = Number(opt.market_data?.ask_price || opt.market_data?.ask || 0);
      
      if (price > 0 && bidPrice > 0 && askPrice >= bidPrice) {
         const spread = ((askPrice - bidPrice) / price) * 100;
         if (spread <= maxSpread && spread < bestSpread) {
            bestSpread = spread;
            bestOption = {
                strike: Number(row.strike_price),
                price, bidPrice, askPrice,
                instrumentKey: opt.instrument_key || ''
            };
         }
      }
    }
    
    return bestOption || undefined;
  }`;

code = code.replace(oldSelectStrike, newSelectStrike);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
