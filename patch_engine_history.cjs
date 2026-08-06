const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/getNearestExpiry\?: GetNearestExpiryFn/g, "getNearestExpiry?: GetNearestExpiryFn,\n    getOptionChainHistory?: () => any[]");
code = code.replace(/this\.getNearestExpiry = getNearestExpiry;/g, "this.getNearestExpiry = getNearestExpiry;\n    this.getOptionChainHistory = getOptionChainHistory;");
code = code.replace(/private getNearestExpiry\?: GetNearestExpiryFn;/g, "private getNearestExpiry?: GetNearestExpiryFn;\n  private getOptionChainHistory?: () => any[];");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
