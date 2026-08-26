const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

const oldRule10 = `export function rule10BreakoutConfirmation(setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST' || setup.setupType === 'OPENING_TRAP') {
    if (setup.breakCandleIndex === undefined) return fail('FAILED_BREAKOUT_CONF: Missing breakout history');
  }
  return pass();
}`;

const newRule10 = `export function rule10BreakoutConfirmation(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN' || setup.setupType === 'FAILED_RETEST' || setup.setupType === 'OPENING_TRAP') {
    if (setup.breakCandleIndex === undefined) return fail('FAILED_BREAKOUT_CONF: Missing breakout history');
    
    // RVOL Check for Breakouts
    if ((setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN') && setup.c2) {
      if (ctx.candles1m && ctx.candles1m.length >= 20) {
        const volumes = ctx.candles1m.map(c => c.volume || 0);
        const volSMAArray = computeSMA(volumes, 20);
        const volSMA = volSMAArray[volSMAArray.length - 1];
        if (!isNaN(volSMA) && volSMA > 0) {
          const c2Volume = setup.c2.volume || 0;
          if (c2Volume < volSMA * 1.2) {
            return fail('FAILED_RVOL: Breakout lacks institutional volume');
          }
        }
      }
    }
  }
  return pass();
}`;

const oldRule12 = `export function rule12ConfirmationCandle(setup: ProposedSetup, index: string): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  if (!c0) return fail('FAILED_CONF_CANDLE: Missing confirmation candle');

  if (isCall && c0.close <= c0.open) return fail('FAILED_CONF_CANDLE: CALL setup requires green confirmation candle');
  if (!isCall && c0.close >= c0.open) return fail('FAILED_CONF_CANDLE: PUT setup requires red confirmation candle');
  
  return pass();
}`;

const newRule12 = `export function rule12ConfirmationCandle(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  const isCall = setup.direction === 'CALL';
  const c0 = setup.c0;
  if (!c0) return fail('FAILED_CONF_CANDLE: Missing confirmation candle');

  if (isCall && c0.close <= c0.open) return fail('FAILED_CONF_CANDLE: CALL setup requires green confirmation candle');
  if (!isCall && c0.close >= c0.open) return fail('FAILED_CONF_CANDLE: PUT setup requires red confirmation candle');
  
  // RVOL Check for Traps
  if (setup.setupType === 'OPENING_TRAP') {
    if (ctx.candles1m && ctx.candles1m.length >= 20) {
      const volumes = ctx.candles1m.map(c => c.volume || 0);
      const volSMAArray = computeSMA(volumes, 20);
      const volSMA = volSMAArray[volSMAArray.length - 1];
      if (!isNaN(volSMA) && volSMA > 0) {
        const c0Volume = c0.volume || 0;
        if (c0Volume < volSMA * 1.5) {
          return fail('FAILED_RVOL: Opening trap lacks institutional reversal volume');
        }
      }
    }
  }
  
  return pass();
}`;

code = code.replace(oldRule10, newRule10);
code = code.replace(oldRule12, newRule12);
code = code.replace("rule10BreakoutConfirmation(setup)", "rule10BreakoutConfirmation(ctx, setup)");
code = code.replace("rule12ConfirmationCandle(setup, ctx.index)", "rule12ConfirmationCandle(ctx, setup)");

fs.writeFileSync('src/backend/validation-rules.ts', code);
