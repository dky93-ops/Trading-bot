const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/premiumSeriesLast3\?: number\[\], oiSeriesLast3\?: number\[\]/, "seriesData?: any");

code = code.replace(/ceOpt: direction === 'CALL' \? opt : undefined,[\s\S]*?wallTestCount: testCount/, 
`ceOpt: direction === 'CALL' ? opt : undefined,
      peOpt: direction === 'PUT' ? opt : undefined,
      structureId,
      barsSinceBreakout,
      barsSinceRetest,
      impulseRange,
      spotMoveFromLevel,
      spotSeriesLast3: seriesData?.spotSeriesLast3 || [],
      callPremiumSeriesLast3: seriesData?.callPremiumSeriesLast3 || [],
      putPremiumSeriesLast3: seriesData?.putPremiumSeriesLast3 || [],
      callOiSeriesLast3: seriesData?.callOiSeriesLast3 || [],
      putOiSeriesLast3: seriesData?.putOiSeriesLast3 || [],
      oppCallOiSeriesLast3: seriesData?.oppCallOiSeriesLast3 || [],
      oppPutOiSeriesLast3: seriesData?.oppPutOiSeriesLast3 || [],
      volumeSeriesLast3: seriesData?.volumeSeriesLast3 || [],
      ivSeriesLast3: seriesData?.ivSeriesLast3 || [],
      deltaSeriesLast3: seriesData?.deltaSeriesLast3 || [],
      thetaSeriesLast3: seriesData?.thetaSeriesLast3 || [],
      gammaSeriesLast3: seriesData?.gammaSeriesLast3 || [],
      vegaSeriesLast3: seriesData?.vegaSeriesLast3 || [],
      wallTestCount: testCount`);
      
// Fix stopLoss -> stoploss in validateSetup
code = code.replace(/target1, target2, stopLoss,/g, "target1, target2, stoploss,");
code = code.replace(/target1, target2, stoploss: number/g, "target1: number, target2: number, stoploss: number");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
