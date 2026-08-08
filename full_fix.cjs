const fs = require('fs');

// types.ts
let types = fs.readFileSync('src/backend/types.ts', 'utf8');
types = types.replace(/export interface InternalSignal extends EngineDecision {/g, 'export interface InternalSignal {');
// Need to add EngineDecision fields to InternalSignal
const internalSignalFields = `
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
`;
types = types.replace(/export interface InternalSignal {/g, 'export interface InternalSignal {' + internalSignalFields);
fs.writeFileSync('src/backend/types.ts', types);

// strategy-engine.ts
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Change evaluateIndex signature
engine = engine.replace(/private async evaluateIndex\(index: string, spotPrice: number\): Promise<any> {/g, 'private async evaluateIndex(index: string, spotPrice: number): Promise<{ decision: EngineDecision, internal?: InternalSignal }> {');
engine = engine.replace(/private async evaluateIndex\(index: string, spotPrice: number\): Promise<InternalSignal \| null> {/g, 'private async evaluateIndex(index: string, spotPrice: number): Promise<{ decision: EngineDecision, internal?: InternalSignal }> {');

// Change createNoTrade
engine = engine.replace(/private createNoTrade[\s\S]*?\} as any;/g, `private createNoTrade(index: string, spot: number, reason: string): { decision: EngineDecision } {
    return {
      decision: {
        timestamp: new Date().toISOString(),
        signal: 'NO_TRADE',
        strategy_family: 'NONE',
        direction: 'NONE',
        spot: spot,
        broken_level: 0,
        wall_above: 0,
        wall_below: 0,
        option_type: 'NONE',
        strike: 0,
        entry: 0,
        stoploss: 0,
        target1: 0,
        target2: 0,
        confidence: 0,
        reason: [reason],
        fake_signal_filters_passed: [],
        fake_signal_filters_failed: []
      }
    };`);

// Check if return statements for createNoTrade need changes
// They are returning this.createNoTrade(...). That's fine now because it returns { decision: ... }

// End of evaluateIndex
// Current end returns a single object which we casted to InternalSignal or EngineDecision
const returnObjRegex = /return \{\s*id: crypto\.randomUUID\(\),[\s\S]*?signal: signalType,[\s\S]*?\};/g;
if (engine.match(returnObjRegex)) {
    const returnObj = engine.match(returnObjRegex)[0];
    const newReturnObj = `const internalSig: InternalSignal = ${returnObj.replace('return {', '{')};
    const decision: EngineDecision = {
      timestamp: internalSig.timestamp,
      signal: internalSig.signal,
      strategy_family: internalSig.strategy_family,
      direction: internalSig.direction,
      spot: internalSig.spot,
      broken_level: internalSig.broken_level,
      wall_above: internalSig.wall_above,
      wall_below: internalSig.wall_below,
      option_type: internalSig.option_type,
      strike: internalSig.strike,
      entry: internalSig.entry,
      stoploss: internalSig.stoploss,
      target1: internalSig.target1,
      target2: internalSig.target2,
      confidence: internalSig.confidence,
      reason: internalSig.reason,
      fake_signal_filters_passed: internalSig.fake_signal_filters_passed,
      fake_signal_filters_failed: internalSig.fake_signal_filters_failed
    };
    return { decision, internal: internalSig };`;
    engine = engine.replace(returnObjRegex, newReturnObj);
}

// And replace how evaluateIndex is called
// const sig = await this.evaluateIndex(...)
// if (sig) {
const evaluateIndexUsage = /const sig = await this\.evaluateIndex\('NIFTY', this\.state\.nifty50\.lastPrice\);\s*if \(sig\) \{\s*if \(sig\.signal !== 'NO_TRADE'\) \{\s*newSignals\.push\(sig\);\s*decisions\.push\(this\.mapToPublicDecision\(sig\)\);\s*\} else \{\s*decisions\.push\(this\.mapToPublicDecision\(sig\)\);\s*\}\s*\}/g;

const newEvaluateIndexUsage = `const res = await this.evaluateIndex('NIFTY', this.state.nifty50.lastPrice);
      if (res) {
        if (res.internal && res.decision.signal !== 'NO_TRADE') {
          newSignals.push(res.internal);
        }
        decisions.push(res.decision);
      }`;
engine = engine.replace(evaluateIndexUsage, newEvaluateIndexUsage);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
