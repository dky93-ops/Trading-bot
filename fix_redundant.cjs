const fs = require('fs');
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

// The array inside runSetupSafetyChecks / runSetupValidation
// We want to remove rule1, rule3, rule4 from there.
const toReplace = /rule1CompletedCandles\(ctx\.candles1m, ctx\.timeObj\),\s*rule2OpeningFilter\(ctx\.timeStr, setup\),\s*rule3OneOpenTrade\(ctx\.activeSignals\),\s*rule4Cooldown\(ctx\.sessState, ctx\.timeObj\.getTime\),\s*/m;
rules = rules.replace(toReplace, 'rule2OpeningFilter(ctx.timeStr, setup),\n    ');
fs.writeFileSync('src/backend/validation-rules.ts', rules);
