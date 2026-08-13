const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /private getHistoricalPremium\([\s\S]*?\n  \}/m;

const replacement = `private getAlignedPremiumCandle(
    strike: number,
    type: 'CE' | 'PE',
    spotCandle: Candle
  ): {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    iv: number;
  } | undefined {
    const startMs = new Date(spotCandle.timestamp).getTime();
    const endMs = startMs + 60_000;

    const snapshots = this.getOptionChainHistory ? this.getOptionChainHistory()
      .filter((s: any) => {
        const ts = Number(s.timestamp);
        return ts >= startMs && ts < endMs;
      })
      .sort((a: any, b: any) => Number(a.timestamp) - Number(b.timestamp)) : [];

    if (snapshots.length === 0) {
      return undefined;
    }

    const values: Array<{
      ltp: number;
      volume: number;
      iv: number;
    }> = [];

    for (const snap of snapshots) {
      const row = snap.rows?.find((r: any) => Number(r.strike) === Number(strike));
      if (!row) continue;
      const option = type === 'CE' ? row.ce : row.pe;
      const ltp = Number(option?.ltp || 0);
      if (ltp <= 0) continue;

      values.push({
        ltp,
        volume: Number(option?.volume || 0),
        iv: Number(option?.iv || 0)
      });
    }

    if (values.length === 0) {
      return undefined;
    }

    return {
      open: values[0].ltp,
      high: Math.max(...values.map(v => v.ltp)),
      low: Math.min(...values.map(v => v.ltp)),
      close: values[values.length - 1].ltp,
      volume: Math.max(...values.map(v => v.volume)),
      iv: values[values.length - 1].iv
    };
  }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Added getAlignedPremiumCandle');
