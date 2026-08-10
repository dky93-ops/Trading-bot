const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /^import \{[\s\S]*?from '\.\/data-store';\n+/;

const replacement = `import {
  AppSettings,
  AppState,
  EngineDecision,
  InternalSignal,
  StrategySessionState,
  Candle
} from './types';
import { runGlobalPreChecks, runSetupValidation, ValidationContext, ProposedSetup } from './validation-rules';

export type LocalSessionState = StrategySessionState;

export interface OIWall {
  strike: number;
  totalOI: number;
  avgSurroundingOI: number;
  oiRatio: number;
  type: 'CE' | 'PE';
  oiChange?: number;
}

export type FetchOptionDataFn = (instrumentKey: string) => Promise<any>;
export type GetOptionChainFn = (instrumentKey: string, expiry: string) => Promise<any>;
export type GetNearestExpiryFn = (instrumentKey: string) => Promise<string>;

const getCandles = (index: string, tf: string): Candle[] => []; // Mocked, assuming data-store is removed or needs this

`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed imports');
