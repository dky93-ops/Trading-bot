const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Fix duplicate 'stoploss' in NO_TRADE signal creation (around line 392)
code = code.replace(/entryPrice: 0,\n      stoploss: 0,\n      \n      status: 'CLOSED',/g, "entryPrice: 0,\n      \n      status: 'CLOSED',");

// Fix 'stoploss' instead of 'stopLoss' in ProposedSetup interface / usages in strategy-engine.ts
// At line 485:
code = code.replace(/direction, level: lvl, setupType, c0, c1, c2, target1, target2, stoploss,/g, "direction, level: lvl, setupType, c0, c1, c2, target1, target2, stopLoss: stoploss,");

// Around line 1078, duplicate 'stoploss', and invalid 'target'.
code = code.replace(/highestPrice: premium,\n      stoploss: slPrice,\n      target: target1Price,\n      status: 'ACTIVE',/g, "highestPrice: premium,\n      status: 'ACTIVE',");

// Also around line 1098, duplicate stoploss in createSignal
code = code.replace(/entry: premium,\n      stoploss: slPrice,\n      target1: target1Price,/g, "entry: premium,\n      target1: target1Price,");

// In src/backend/validation-rules.ts
let rulesCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

rulesCode = rulesCode.replace(/setup\.premiumSeriesLast3/g, "setup.putPremiumSeriesLast3");
rulesCode = rulesCode.replace(/setup\.oppPremiumSeriesLast3/g, "setup.callPremiumSeriesLast3");
rulesCode = rulesCode.replace(/setup\.oiSeriesLast3/g, "setup.putOiSeriesLast3");
rulesCode = rulesCode.replace(/setup\.oppOiSeriesLast3/g, "setup.oppPutOiSeriesLast3");

// Also the rule around 442 where it refers to CALL
// Oh wait, let's just make it replace all incorrectly named variables.
// Actually, it's better to just run the find and replace over validation-rules.ts properly.

fs.writeFileSync('src/backend/strategy-engine.ts', code);
fs.writeFileSync('src/backend/validation-rules.ts', rulesCode);
