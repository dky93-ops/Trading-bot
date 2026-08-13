const fs = require('fs');

let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /export function rule20MarketFilters\([\s\S]*?\n\s*return success\('Market conditions favorable'\);\n\}/m;

const replacement = `export function rule20MarketFilters(
  ctx: ValidationContext,
  setup: ProposedSetup
): RuleResult {
  if (ctx.timeStr >= '15:00') {
    return fail('FAILED_TIME_FILTER: NO_NEW_TRADE at or after 15:00 IST');
  }

  if (setup.setupType === 'OPENING_TRAP' && ctx.sessState.previousDayClose) {
    const gapDistance = Math.abs(setup.c0.close - ctx.sessState.previousDayClose);
    if (gapDistance < 20) {
      return fail(\`FAILED_MARKET_CONDITIONS: Gap distance \${gapDistance.toFixed(2)} < 20 points\`);
    }
  }

  const opt = setup.direction === 'CALL' ? setup.ceOpt : setup.peOpt;
  if (!opt || Number(opt.price || 0) <= 0) {
    return fail('FAILED_LIQUIDITY: Selected option LTP unavailable');
  }

  const bid = Number(opt.bidPrice || 0);
  const ask = Number(opt.askPrice || 0);
  const ltp = Number(opt.price);
  
  if (bid > 0 && ask > 0 && ask >= bid) {
    const spread = ((ask - bid) / ltp) * 100;
    setup.spreadPercent = spread;
    
    // Check expiry
    const isExpiry = ctx.sessState.isExpiryDay || false; // Wait, do we have isExpiryDay? The prompt says "ON THE EXPIRY DAY OF THIS EXACT OPTION". We can assume ctx.sessState.isExpiryDay is set or we can deduce it from the date. 
    // Let's assume the previous logic handles this or we just use ctx.sessState.isExpiryDay. Actually I'll use a safer check. 
    let isExp = false;
    if (opt.expiryDate) {
      const optDate = new Date(opt.expiryDate).toISOString().split('T')[0];
      const todayDate = new Date(ctx.timeMs).toISOString().split('T')[0];
      if (optDate === todayDate) isExp = true;
    }

    const maxSpread = (isExp && ctx.timeStr >= '14:00') ? 1.5 : 3.0;
    if (spread > maxSpread) {
      return fail(\`FAILED_LIQUIDITY: Spread \${spread.toFixed(2)}% > max \${maxSpread}%\`);
    }
  }

  const ivAvg = setup.ivAvg || 0;
  setup.ivPenalty = 0;
  if (ivAvg > 0) {
    if (setup.setupType === 'OPENING_TRAP' && !setup.earlyStrongWindow && ivAvg > 20) {
      setup.ivPenalty = 20;
    } else if (setup.setupType !== 'OPENING_TRAP' && ivAvg < 12) {
      setup.ivPenalty = 20;
    }
  }

  return success('Market conditions favorable');
}`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('PATCH 4 rule20 complete');
