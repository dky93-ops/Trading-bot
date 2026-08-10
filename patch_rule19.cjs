const fs = require('fs');

let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /if \(setup\.setupType === 'OI_WALL_REJECTION'\) \{[\s\S]*?premiumAtConfirmation[\s\S]*?\}/;

const replacement = `const isWallBased = setup.setupType === 'OI_WALL_REJECTION';

  if (isWallBased) {
    const reactions = ctx.sessState.wallReactionCandleKeys?.[setup.level]?.length || 0;
    const tests = ctx.sessState.wallTestCandleKeys?.[setup.level]?.length || 0;

    if (reactions < 1) {
      return fail('FAILED_OVERALL_AGREEMENT: Wall has no session reaction');
    }
    if (tests < 2) {
      return fail('FAILED_OVERALL_AGREEMENT: Wall has fewer than 2 distinct tests');
    }
    if (!ctx.sessState.wallOIWeakeningConfirmed?.[setup.level]) {
      return fail('FAILED_OVERALL_AGREEMENT: Wall weakening not confirmed');
    }
  }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('rule19 patched');
