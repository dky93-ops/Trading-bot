const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const getOIChange = \([\s\S]*?\}\;/g;

const replacement = `const getOIChange = (row: any, side: 'CE' | 'PE'): number => {
  const md =
    side === 'CE'
      ? row.call_options?.market_data
      : row.put_options?.market_data;

  return Number(
    md?.oi_change ??
    md?.oiChange ??
    0
  );
};`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 0 getOIChange complete');
