const fs = require('fs');
let code = fs.readFileSync('src/backend/types.ts', 'utf8');

const decision = `export interface EngineDecision {
  timestamp: string;
  signal: 'BUY_CALL' | 'BUY_PUT' | 'NO_TRADE';
  strategy_family: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION' | 'NONE';
  direction: 'CALL' | 'PUT' | 'NONE';
  spot: number;
  broken_level: number;
  wall_above: number;
  wall_below: number;
  option_type: 'CE' | 'PE' | 'NONE';
  strike: number;
  entry: number;
  stoploss: number;
  target1: number;
  target2: number;
  confidence: number;
  reason: string[];
  fake_signal_filters_passed: string[];
  fake_signal_filters_failed: string[];
}
`;

code = code.replace(/export interface Signal \{[\s\S]*?fake_signal_filters_failed: string\[\];\n\}/, decision + `
export interface Signal extends EngineDecision {
  id: string;
  index: string;
  contract: string;
  instrumentKey?: string;
  action: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  latestPrice?: number;
  exitPrice?: number;
  exitTime?: number;
  realizedPnL?: number;
  status: 'ACTIVE' | 'CLOSED';
  highestPrice?: number;
  partialExit?: boolean;
  leg?: 'MAIN' | 'HEDGE';
  isStraddle?: boolean;
  breakevenShifted?: boolean;
  timeStop?: string;
  tradeType?: 'CE' | 'PE';
  firstTargetHitFlag?: boolean;
  trailingStopActiveFlag?: boolean;
  confirmationCandleLow?: number;
  confirmationCandleHigh?: number;
  initialRiskPoints?: number;
  confirmationZonePrice?: number;
  structureId?: string;
  barsSinceBreakout?: number;
  barsSinceRetest?: number;
  premiumTrend?: number[];
  oiTrend?: number[];
  impulseRange?: number;
  structureKey?: string;
}`);

fs.writeFileSync('src/backend/types.ts', code);
