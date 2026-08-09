const fs = require('fs');
let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

rules = rules.replace(/if \(ctx\.sessState\.wallOIWeakeningConfirmed\[setup\.level\]\) return fail\('FAILED_WALL_DOMINANCE: CE OI is rapidly weakening.*?;\n\s*if \(ctx\.sessState\.wallNegativeOICounts\[setup\.level\] >= 2\) return fail\('FAILED_WALL_DOMINANCE: CE OI dropped for 2 consecutive ticks'\);/, '');
rules = rules.replace(/if \(ctx\.sessState\.wallOIWeakeningConfirmed\[setup\.level\]\) return fail\('FAILED_WALL_DOMINANCE: PE OI is rapidly weakening.*?;\n\s*if \(ctx\.sessState\.wallNegativeOICounts\[setup\.level\] >= 2\) return fail\('FAILED_WALL_DOMINANCE: PE OI dropped for 2 consecutive ticks'\);/, '');

fs.writeFileSync('src/backend/validation-rules.ts', rules);
