const fs = require('fs');

let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

valCode = valCode.replace(
  'ivSeriesLast3: number[];',
  `ivSeriesLast3: number[];
  deltaSeriesLast3?: number[];
  thetaSeriesLast3?: number[];
  gammaSeriesLast3?: number[];
  vegaSeriesLast3?: number[];
  wallTestCount?: number;`
);

fs.writeFileSync('src/backend/validation-rules.ts', valCode);
