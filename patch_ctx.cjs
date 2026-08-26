const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

const oldCtx = `export interface ValidationContext {
  activeSignals: Map<string, InternalSignal>;
  index: string;
  spotPrice: number;
  timeObj: Date;
  timeStr: string;
  sessState: StrategySessionState;
  candles1m: Candle[];
  chainRows: any[];
  nearestCeWallAbove: number;
  nearestPeWallBelow: number;
}`;

const newCtx = `export interface ValidationContext {
  activeSignals: Map<string, InternalSignal>;
  index: string;
  spotPrice: number;
  timeObj: Date;
  timeStr: string;
  sessState: StrategySessionState;
  candles1m: Candle[];
  chainRows: any[];
  nearestCeWallAbove: number;
  nearestPeWallBelow: number;
  settings?: any;
}`;

code = code.replace(oldCtx, newCtx);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('patched ctx');
