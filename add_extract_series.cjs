const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const helper = `
  private extractSeries(strike: number) {
    const empty = {
      spotSeriesLast3: [],
      callPremiumSeriesLast3: [],
      putPremiumSeriesLast3: [],
      callOiSeriesLast3: [],
      putOiSeriesLast3: [],
      oppCallOiSeriesLast3: [],
      oppPutOiSeriesLast3: [],
      volumeSeriesLast3: [],
      ivSeriesLast3: [],
      deltaSeriesLast3: [],
      thetaSeriesLast3: [],
      gammaSeriesLast3: [],
      vegaSeriesLast3: []
    };

    if (!this.getOptionChainHistory) return empty;
    const history = this.getOptionChainHistory();
    if (!history || history.length < 3) return empty;

    const last3 = history.slice(-3);
    const result = {
      spotSeriesLast3: [] as number[],
      callPremiumSeriesLast3: [] as number[],
      putPremiumSeriesLast3: [] as number[],
      callOiSeriesLast3: [] as number[],
      putOiSeriesLast3: [] as number[],
      oppCallOiSeriesLast3: [] as number[],
      oppPutOiSeriesLast3: [] as number[],
      volumeSeriesLast3: [] as number[],
      ivSeriesLast3: [] as number[],
      deltaSeriesLast3: [] as number[],
      thetaSeriesLast3: [] as number[],
      gammaSeriesLast3: [] as number[],
      vegaSeriesLast3: [] as number[]
    };

    for (const snap of last3) {
      // Assuming snap contains rows and spot
      // Wait, we need to find the strike in rows
      if (snap.spotPrice) {
        result.spotSeriesLast3.push(snap.spotPrice);
      }
      
      const row = snap.rows?.find((r: any) => r.strike === strike);
      if (row) {
        result.callPremiumSeriesLast3.push(row.ce?.ltp || 0);
        result.putPremiumSeriesLast3.push(row.pe?.ltp || 0);
        result.callOiSeriesLast3.push(row.ce?.oi || 0);
        result.putOiSeriesLast3.push(row.pe?.oi || 0);
        // opposite is same since we pass both, but we can populate them
        result.oppCallOiSeriesLast3.push(row.ce?.oi || 0);
        result.oppPutOiSeriesLast3.push(row.pe?.oi || 0);
        
        result.volumeSeriesLast3.push((row.ce?.volume || 0) + (row.pe?.volume || 0));
        result.ivSeriesLast3.push(row.ce?.iv || row.pe?.iv || 0);
        result.deltaSeriesLast3.push(row.ce?.delta || 0);
        result.thetaSeriesLast3.push(row.ce?.theta || 0);
        result.gammaSeriesLast3.push(row.ce?.gamma || 0);
        result.vegaSeriesLast3.push(row.ce?.vega || 0);
      }
    }
    
    return result;
  }
`;

code = code.replace(/private validateSetup\(/, helper + '\n  private validateSetup(');
fs.writeFileSync('src/backend/strategy-engine.ts', code);
