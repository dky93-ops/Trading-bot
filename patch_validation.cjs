const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const replacement = `export interface ProposedSetup {
  direction: 'CALL' | 'PUT';
  level: number;
  setupType: string;
  c0: Candle;
  c1: Candle;
  c2?: Candle;
  target1: number;
  target2: number;
  stopLoss: number;
  ceOpt?: any;
  peOpt?: any;
  barsSinceBreakout?: number;
  barsSinceRetest?: number;
  impulseRange?: number;
  spotMoveFromLevel?: number;
  spotSeriesLast3: number[];
  callPremiumSeriesLast3: number[];
  putPremiumSeriesLast3: number[];
  callOiSeriesLast3: number[];
  putOiSeriesLast3: number[];
  oppCallOiSeriesLast3: number[];
  oppPutOiSeriesLast3: number[];
  volumeSeriesLast3: number[];
  ivSeriesLast3: number[];
  deltaSeriesLast3: number[];
  thetaSeriesLast3: number[];
  gammaSeriesLast3: number[];
  vegaSeriesLast3: number[];
  structureId?: string;
  retestTouchCount?: number;
  wallTestCount?: number;
}`;

code = code.replace(/export interface ProposedSetup \{[\s\S]*?wallTestCount\?: number;\n\}/, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', code);
