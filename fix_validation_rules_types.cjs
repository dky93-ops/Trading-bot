const fs = require('fs');

let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
const proposedSetupRegex = /export interface ProposedSetup \{[\s\S]*?\[key: string\]: any; \/\/ Allow other dynamically added properties without TS errors\n\}/;
const newProposedSetup = `export interface ProposedSetup {
  direction: 'CALL' | 'PUT';
  level: number;
  setupType: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION';
  c0: Candle;
  c1: Candle;
  c2?: Candle;
  target1: number;
  target2: number;
  stopLoss: number;
  ceOpt?: any;
  peOpt?: any;
  structureId?: string;

  breakCandleIndex?: number;
  retestCandleIndex?: number;
  confirmationCandleIndex?: number;

  barsSinceBreakout?: number;
  barsSinceRetest?: number;

  premiumAtBreak?: number;
  premiumAtRetestLow?: number;
  premiumAtConfirmation?: number;

  wallOIAtReference?: number;
  wallOIAtCurrent?: number;
  wallOIWeakeningPercent?: number;
  wallNegativeOIConsecutive?: number;

  wallTestCount?: number;
  wallLastTestCandleTimestamp?: string;

  hasSessionReaction?: boolean;
  hasTwoDistinctWallTests?: boolean;

  confirmationCandleGreen?: boolean;
  confirmationCandleRed?: boolean;

  continuationPauseValid?: boolean;

  firstImpulseRange?: number;
  moveFromBreakoutLevel?: number;
  spotMoveFromLevel?: number;

  spotSeriesLast3?: number[];
  callPremiumSeriesLast3?: number[];
  putPremiumSeriesLast3?: number[];
  [key: string]: any;
}`;
rules = rules.replace(proposedSetupRegex, newProposedSetup);
fs.writeFileSync('src/backend/validation-rules.ts', rules);
