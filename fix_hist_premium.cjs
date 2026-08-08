const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const helper = `
  private getHistoricalPremium(strike: number, type: 'CE' | 'PE', targetTime: string): number | undefined {
    if (!this.getOptionChainHistory) return undefined;
    const history = this.getOptionChainHistory();
    if (!history || history.length === 0) return undefined;
    
    // Find the closest history entry to the targetTime
    const targetMs = new Date(targetTime).getTime();
    let closestRow = null;
    let minDiff = Infinity;
    
    for (const snap of history) {
      if (!snap.timestamp) continue;
      const diff = Math.abs(new Date(snap.timestamp).getTime() - targetMs);
      if (diff < minDiff && diff < 60000) { // within 1 minute
        closestRow = snap;
        minDiff = diff;
      }
    }
    
    if (!closestRow || !closestRow.data) return undefined;
    
    const row = closestRow.data.find((r: any) => r.strike_price === strike);
    if (!row) return undefined;
    
    if (type === 'CE') return row.call_options?.market_data?.last_price;
    if (type === 'PE') return row.put_options?.market_data?.last_price;
    return undefined;
  }

  private extractSeries`;

engine = engine.replace('  private extractSeries', helper);
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
