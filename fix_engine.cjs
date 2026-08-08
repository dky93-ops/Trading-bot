const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

engine = engine.replace(/private async evaluateIndex\(index: string, spotPrice: number\): Promise<\{ decision: EngineDecision, internal\?: InternalSignal \}> \{/g, 'private async evaluateIndex(index: string, spotPrice: number): Promise<InternalSignal> {');

// Fix createNoTrade return type
engine = engine.replace(/private createNoTrade\(index: string, spot: number, reason: string\): \{ decision: EngineDecision \} \{[\s\S]*?decision: \{([\s\S]*?)\}\s*\};/m, `private createNoTrade(index: string, spot: number, reason: string): InternalSignal {
    return {
$1
    } as InternalSignal;`);

// Fix usage in onTick
const usageRegex = /const res = await this\.evaluateIndex\('NIFTY', this\.state\.nifty50\.lastPrice\);\s*if \(res\) \{\s*if \(res\.internal && res\.decision\.signal !== 'NO_TRADE'\) \{\s*newSignals\.push\(res\.internal\);\s*\}\s*decisions\.push\(res\.decision\);\s*\}/g;
const newUsage = `const sig = await this.evaluateIndex('NIFTY', this.state.nifty50.lastPrice);
      if (sig) {
        if (sig.signal !== 'NO_TRADE') {
          newSignals.push(sig);
        }
        decisions.push(this.mapToPublicDecision(sig));
      }`;
engine = engine.replace(usageRegex, newUsage);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
