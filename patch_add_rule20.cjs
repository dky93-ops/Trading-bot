const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

code = code.replace(
  /rule19TrailingCondition\(ctx\.sessState, setup\)/,
  "rule19TrailingCondition(ctx.sessState, setup),\n    rule20MarketFilters(ctx, setup)"
);
fs.writeFileSync('src/backend/validation-rules.ts', code);
console.log('Added rule20 to array');
