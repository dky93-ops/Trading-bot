const fs = require('fs');
let code = fs.readFileSync('src/backend/technical-indicators.ts', 'utf-8');

if (!code.includes('computeVWAP')) {
  code += `\nexport function computeVWAP(candles: {high: number, low: number, close: number, volume?: number}[]): number[] {
  const vwap: number[] = new Array(candles.length).fill(NaN);
  let cumVol = 0;
  let cumVolPrice = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;
    cumVol += vol;
    cumVolPrice += typicalPrice * vol;
    vwap[i] = cumVolPrice / cumVol;
  }
  return vwap;
}\n`;
  fs.writeFileSync('src/backend/technical-indicators.ts', code);
}
console.log('Added computeVWAP');
