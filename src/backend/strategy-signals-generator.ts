import { InternalSignal, Candle, StrategySessionState } from './types.js';
import { ProposedSetup } from './validation-rules.js';

export interface TradeSignal {
  id: string;
  timestamp: number;
  strategy: string;
  direction: 'CALL' | 'PUT';
  spot: number;
  level: number;
  entry: number;
  stoploss: number;
  target1: number;
  target2: number;
  confidence: number;
  reason: string[];
}

/**
 * Converts validated setups into actionable trade signals
 */
export class StrategySignalsGenerator {
  /**
   * Generate FAILED_RETEST signal
   */
  public static generateFailedRetestSignal(
    index: string,
    spot: number,
    level: number,
    direction: 'CALL' | 'PUT',
    candles: Candle[],
    setup: ProposedSetup,
    optionData: any,
    confidence: number,
    passed: string[]
  ): InternalSignal | null {
    if (!optionData) return null;

    

    const optionEntry = Number(optionData.price);
    const optionStoploss = (optionData as any).structuralOptionStop || (optionEntry * 0.65); // 35% max loss

    if (!(optionEntry > 0)) return null;

    const optRisk = Math.max(optionEntry - optionStoploss, 8);
    const optionTarget1 = Number((optionEntry + Math.max(optRisk * 1.3, 14)).toFixed(2));
    const optionTarget2 = Number((optionEntry + Math.max(optRisk * 2.6, 28)).toFixed(2));

    return {
      id: `FR_${index}_${Date.now()}`,
      index,
      contract: 'NIFTY',
      instrumentKey: optionData.instrumentKey,
      timestamp: new Date().toISOString(),
      signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
      strategy_family: 'FAILED_RETEST' as any,
      strategy: 'FAILED_RETEST',
      direction,
      action: 'BUY' as const,
      status: 'ACTIVE' as const,
      spotEntry: spot,
      spotInvalidation: setup.stopLoss || level,
      spotTarget1: setup.target1 || spot,
      spotTarget2: setup.target2 || spot,
      entryPrice: optionEntry,
      entry: optionEntry,
      stoploss: optionStoploss,
      optionEntry,
      optionStoploss,
      optionTarget1,
      optionTarget2,
      target1: optionTarget1,
      target2: optionTarget2,
      broken_level: level,
      confidence,
      reason: passed,
      spot,
      prices: {
        spotEntry: spot,
        spotInvalidation: setup.stopLoss || level,
        spotTarget1: setup.target1 || spot,
        spotTarget2: setup.target2 || spot,
        optionEntry,
        optionStoploss,
        optionTarget1,
        optionTarget2
      },
      latestPrice: optionEntry,
      latestSpot: spot,
      latestSpotTimestamp: Date.now(),
      latestOptionTimestamp: Date.now(),
      highestPrice: optionEntry,
      firstTargetHitFlag: false,
      trailingStopActiveFlag: false,
      barsSinceBreakout: setup.barsSinceBreakout,
      barsSinceRetest: setup.barsSinceRetest
    } as InternalSignal;
  }

  /**
   * Generate OPENING_TRAP signal
   */
  public static generateOpeningTrapSignal(
    index: string,
    spot: number,
    level: number,
    direction: 'CALL' | 'PUT',
    candles: Candle[],
    setup: ProposedSetup,
    optionData: any,
    confidence: number,
    passed: string[]
  ): InternalSignal | null {
    if (!optionData) return null;

    

    const optionEntry = Number(optionData.price);
    const optionStoploss = (optionData as any).structuralOptionStop || (optionEntry * 0.65);

    if (!(optionEntry > 0)) return null;

    const optRisk = Math.max(optionEntry - optionStoploss, 8);
    const optionTarget1 = Number((optionEntry + Math.max(optRisk * 1.3, 14)).toFixed(2));
    const optionTarget2 = Number((optionEntry + Math.max(optRisk * 2.6, 28)).toFixed(2));

    return {
      id: `OT_${index}_${Date.now()}`,
      index,
      contract: 'NIFTY',
      instrumentKey: optionData.instrumentKey,
      timestamp: new Date().toISOString(),
      signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
      strategy_family: 'OPENING_TRAP' as any,
      strategy: 'OPENING_TRAP',
      direction,
      action: 'BUY' as const,
      status: 'ACTIVE' as const,
      spotEntry: spot,
      spotInvalidation: setup.stopLoss || level,
      spotTarget1: setup.target1 || spot,
      spotTarget2: setup.target2 || spot,
      entryPrice: optionEntry,
      entry: optionEntry,
      stoploss: optionStoploss,
      optionEntry,
      optionStoploss,
      optionTarget1,
      optionTarget2,
      target1: optionTarget1,
      target2: optionTarget2,
      broken_level: level,
      confidence,
      reason: passed,
      spot,
      prices: {
        spotEntry: spot,
        spotInvalidation: setup.stopLoss || level,
        spotTarget1: setup.target1 || spot,
        spotTarget2: setup.target2 || spot,
        optionEntry,
        optionStoploss,
        optionTarget1,
        optionTarget2
      },
      latestPrice: optionEntry,
      latestSpot: spot,
      latestSpotTimestamp: Date.now(),
      latestOptionTimestamp: Date.now(),
      highestPrice: optionEntry,
      firstTargetHitFlag: false,
      trailingStopActiveFlag: false,
      barsSinceBreakout: setup.barsSinceBreakout,
      barsSinceRetest: setup.barsSinceRetest
    } as InternalSignal;
  }

  /**
   * Generate CONTINUATION signal (BREAKOUT or BREAKDOWN)
   */
  public static generateContinuationSignal(
    index: string,
    spot: number,
    level: number,
    direction: 'CALL' | 'PUT',
    setupType: 'CONTINUATION_BREAKOUT' | 'CONTINUATION_BREAKDOWN',
    candles: Candle[],
    setup: ProposedSetup,
    optionData: any,
    confidence: number,
    passed: string[]
  ): InternalSignal | null {
    if (!optionData) return null;

    const optionEntry = Number(optionData.price);
    const optionStoploss = (optionData as any).structuralOptionStop || (optionEntry * 0.65);

    if (!(optionEntry > 0)) return null;

    const optRisk = Math.max(optionEntry - optionStoploss, 8);
    const optionTarget1 = Number((optionEntry + Math.max(optRisk * 1.3, 14)).toFixed(2));
    const optionTarget2 = Number((optionEntry + Math.max(optRisk * 2.6, 28)).toFixed(2));

    return {
      id: `CT_${index}_${Date.now()}`,
      index,
      contract: 'NIFTY',
      instrumentKey: optionData.instrumentKey,
      timestamp: new Date().toISOString(),
      signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
      strategy_family: setupType as any,
      strategy: setupType,
      direction,
      action: 'BUY' as const,
      status: 'ACTIVE' as const,
      spotEntry: spot,
      spotInvalidation: setup.stopLoss || level,
      spotTarget1: setup.target1 || spot,
      spotTarget2: setup.target2 || spot,
      entryPrice: optionEntry,
      entry: optionEntry,
      stoploss: optionStoploss,
      optionEntry,
      optionStoploss,
      optionTarget1,
      optionTarget2,
      target1: optionTarget1,
      target2: optionTarget2,
      broken_level: level,
      confidence,
      reason: passed,
      spot,
      prices: {
        spotEntry: spot,
        spotInvalidation: setup.stopLoss || level,
        spotTarget1: setup.target1 || spot,
        spotTarget2: setup.target2 || spot,
        optionEntry,
        optionStoploss,
        optionTarget1,
        optionTarget2
      },
      latestPrice: optionEntry,
      latestSpot: spot,
      latestSpotTimestamp: Date.now(),
      latestOptionTimestamp: Date.now(),
      highestPrice: optionEntry,
      firstTargetHitFlag: false,
      trailingStopActiveFlag: false,
      
      barsSinceBreakout: setup.barsSinceBreakout
    } as InternalSignal;
  }

  /**
   * Generate OI_WALL_REJECTION signal
   */
  public static generateWallRejectionSignal(
    index: string,
    spot: number,
    wall: number,
    direction: 'CALL' | 'PUT',
    candles: Candle[],
    setup: ProposedSetup,
    optionData: any,
    confidence: number,
    passed: string[]
  ): InternalSignal | null {
    if (!optionData) return null;

    const optionEntry = Number(optionData.price);
    const optionStoploss = (optionData as any).structuralOptionStop || (optionEntry * 0.65);

    if (!(optionEntry > 0)) return null;

    const optRisk = Math.max(optionEntry - optionStoploss, 8);
    const optionTarget1 = Number((optionEntry + Math.max(optRisk * 1.3, 14)).toFixed(2));
    const optionTarget2 = Number((optionEntry + Math.max(optRisk * 2.6, 28)).toFixed(2));

    return {
      id: `OW_${index}_${Date.now()}`,
      index,
      contract: 'NIFTY',
      instrumentKey: optionData.instrumentKey,
      timestamp: new Date().toISOString(),
      signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
      strategy_family: 'OI_WALL_REJECTION' as any,
      strategy: 'OI_WALL_REJECTION',
      direction,
      action: 'BUY' as const,
      status: 'ACTIVE' as const,
      spotEntry: spot,
      spotInvalidation: setup.stopLoss || wall,
      spotTarget1: setup.target1 || spot,
      spotTarget2: setup.target2 || spot,
      entryPrice: optionEntry,
      entry: optionEntry,
      stoploss: optionStoploss,
      optionEntry,
      optionStoploss,
      optionTarget1,
      optionTarget2,
      target1: optionTarget1,
      target2: optionTarget2,
      broken_level: wall,
      confidence,
      reason: passed,
      spot,
      prices: {
        spotEntry: spot,
        spotInvalidation: setup.stopLoss || wall,
        spotTarget1: setup.target1 || spot,
        spotTarget2: setup.target2 || spot,
        optionEntry,
        optionStoploss,
        optionTarget1,
        optionTarget2
      },
      latestPrice: optionEntry,
      latestSpot: spot,
      latestSpotTimestamp: Date.now(),
      latestOptionTimestamp: Date.now(),
      highestPrice: optionEntry,
      firstTargetHitFlag: false,
      trailingStopActiveFlag: false,
      wallTestCount: setup.wallTestCount
    } as InternalSignal;
  }
}
