const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /\} else if \(setup\.setupType === 'CONTINUATION_BREAKOUT' \|\| setup\.setupType === 'CONTINUATION_BREAKDOWN'\) \{[\s\S]*?\} else if \(setup\.setupType === 'OI_WALL_REJECTION'\) \{/m;

const replacement = `} else if (setup.setupType === 'CONTINUATION_BREAKOUT' || setup.setupType === 'CONTINUATION_BREAKDOWN') {
    if (
      setup.premiumConfirmationClose === undefined ||
      setup.premiumPauseLow === undefined ||
      setup.premiumBreakMidpoint === undefined ||
      setup.premiumConfirmationHigh === undefined
    ) {
      return fail('FAILED_PREMIUM_CONFIRMATION: Missing aligned continuation premium references');
    }

    const remainsAbovePauseLow =
      setup.premiumConfirmationClose >= setup.premiumPauseLow;

    const remainsAboveBreakMidpoint =
      setup.premiumConfirmationClose >= setup.premiumBreakMidpoint;

    const makesHigherHigh =
      setup.premiumConfirmationHigh > setup.premiumBreakHigh!;

    if (!remainsAbovePauseLow || (!remainsAboveBreakMidpoint && !makesHigherHigh)) {
      return fail('FAILED_PREMIUM_CONFIRMATION: Continuation premium did not confirm');
    }
  } else if (setup.setupType === 'OI_WALL_REJECTION') {`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('PATCH 2 rule13 complete');
