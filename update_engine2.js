const fs = require('fs');

const typesCode = `export interface AppSettings {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  isTradingEnabled: boolean;
  nifty50Enabled: boolean;
  bankNiftyEnabled: boolean;
  expiryDate: string;
  strategies: {
    straddle130: StrategyConfig;
    oiDivergence: StrategyConfig;
    bbSqueeze: StrategyConfig;
    orb: StrategyConfig;
    adx9Ema: StrategyConfig;
    vwapBounce: StrategyConfig;
    insideBar: StrategyConfig;
    gammaScalping: StrategyConfig;
    // New strategies
    cprBreakout: StrategyConfig;
    gapFill: StrategyConfig;
    macdDivergence: StrategyConfig;
  };
}

export interface StrategyConfig {
  enabled: boolean;
  lotSize: number;
  slPercent: number;
  targetPercent: number;
  trailingEnabled: boolean;
}

export interface InstrumentData {
  lastPrice: number;
  change: number;
  timestamp: any;
}

export interface AppState {
  nifty50: InstrumentData;
  bankNifty: InstrumentData;
  indiaVix: InstrumentData;
  isConnected: boolean;
  signals: Signal[];
  overallPnL: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
}

export interface Signal {
  id: string;
  timestamp: any;
  index: string;
  contract: string;
  instrumentKey?: string;
  action: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  latestPrice?: number;
  stopLoss: number;
  target: number;
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
}

export interface Candle {
  timestamp: any;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
`;

fs.writeFileSync('src/backend/types.ts', typesCode);
console.log('types.ts updated');
