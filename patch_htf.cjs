const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

const newRule21 = `export function rule21HTFTrendAlignment(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'FAILED_RETEST') {
    const candles = ctx.candles1m;
    if (!candles || candles.length < 30) return pass(); // Not enough data
    
    // Synthesize 15m closes
    // We group by math.floor(time / (15*60*1000))
    const closes15m = [];
    let current15mBlock = -1;
    let lastClose = -1;
    for (const c of candles) {
      const ts = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
      const block = Math.floor(ts / (15 * 60 * 1000));
      if (block !== current15mBlock) {
        if (current15mBlock !== -1) {
          closes15m.push(lastClose);
        }
        current15mBlock = block;
      }
      lastClose = c.close;
    }
    closes15m.push(lastClose); // Push the last one
    
    if (closes15m.length >= 20) {
      const emaArray = computeEMA(closes15m, 20);
      const currentEma = emaArray[emaArray.length - 1];
      const currentSpot = ctx.spotPrice;
      
      if (!isNaN(currentEma)) {
        if (setup.direction === 'CALL' && currentSpot <= currentEma) {
          return fail('FAILED_HTF_ALIGNMENT: Fighting the 15m trend');
        }
        if (setup.direction === 'PUT' && currentSpot >= currentEma) {
          return fail('FAILED_HTF_ALIGNMENT: Fighting the 15m trend');
        }
      }
    }
  }
  return pass();
}`;

if (!code.includes('export function rule21HTFTrendAlignment')) {
  // Add it before export function runSetupValidation
  code = code.replace("export function runSetupValidation", newRule21 + "\n\nexport function runSetupValidation");
  // Add it into the checks array
  code = code.replace("rule20MarketFilters(ctx, setup),", "rule20MarketFilters(ctx, setup),\n    rule21HTFTrendAlignment(ctx, setup),");
  fs.writeFileSync('src/backend/validation-rules.ts', code);
  console.log('patched rule21');
}
