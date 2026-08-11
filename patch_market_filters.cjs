const fs = require('fs');

let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const marketFilter = `
export function rule20MarketFilters(
  ctx: ValidationContext,
  setup: ProposedSetup
): RuleResult {
  if (ctx.timeStr >= '15:00') {
    return fail('FAILED_TIME_FILTER: NO_NEW_TRADE at or after 15:00 IST');
  }
  const opt = setup.direction === 'CALL'
    ? setup.ceOpt
    : setup.peOpt;
  if (!opt || Number(opt.price || 0) <= 0) {
    return fail('FAILED_LIQUIDITY: Selected option LTP unavailable');
  }
  const bid = Number(opt.bidPrice || 0);
  const ask = Number(opt.askPrice || 0);
  const ltp = Number(opt.price);
  if (bid > 0 && ask > 0 && ask >= bid) {
    const spread = ((ask - bid) / ltp) * 100;
    const maxSpread = ctx.timeStr >= '14:00' ? 1.5 : 3.0;
    if (spread > maxSpread) {
      return fail(
        \`FAILED_LIQUIDITY: Spread \${spread.toFixed(3)}% > \${maxSpread}%\`
      );
    }
    setup.spreadPercent = spread;
  } else {
    // Deterministic proxy when bid/ask is unavailable.
    const s = setup.direction === 'CALL'
      ? setup.callPremiumSeriesLast3
      : setup.putPremiumSeriesLast3;
    if (!s || s.length < 3 || s.some(v => !Number.isFinite(v) || v <= 0)) {
      return fail(
        'FAILED_LIQUIDITY: Bid/ask unavailable and 3 valid premium observations unavailable'
      );
    }
    const hi = Math.max(...s);
    const lo = Math.min(...s);
    const avg = s.reduce((a,b) => a+b, 0) / s.length;
    if (avg <= 0 || ((hi - lo) / avg) > 0.10) {
      return fail(
        'FAILED_LIQUIDITY: Premium stability proxy exceeded 10% dispersion'
      );
    }
    setup.spreadPercent = 1.5;
  }
  return pass();
}
`;

code = code.replace(/export function runGlobalPreChecks[\s\S]*/, marketFilter + "\n$&");

fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('Added rule20MarketFilters');
