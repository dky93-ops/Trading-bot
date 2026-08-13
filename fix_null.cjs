const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// In selectStrike, replace createNoTrade with null
code = code.replace(/if \(\!chainRows \|\| chainRows\.length === 0\) return this\.createNoTrade\(index, spotPrice, 'NO_TRADE: no valid strategy setup found'\);/g, 'if (!chainRows || chainRows.length === 0) return null;');
code = code.replace(/if \(\!Number\.isFinite\(ltp\) \|\| ltp <= 0\) return this\.createNoTrade\(index, spotPrice, 'NO_TRADE: no valid strategy setup found'\);/g, 'if (!Number.isFinite(ltp) || ltp <= 0) return null;');

// In createSignal, replace createNoTrade with null
code = code.replace(/if \(\!targets\) return this\.createNoTrade\(index, spotPrice, 'NO_TRADE: no valid strategy setup found'\);/g, 'if (!targets) return null;');
code = code.replace(/return this\.createNoTrade\(index, spotPrice, 'NO_TRADE: no valid strategy setup found'\);/g, 'return null;');

// BUT in evaluateIndex, we DO want it to return createNoTrade at the very end
// So we will patch the end of evaluateIndex manually
code = code.replace(/return null;\n  \}\n\n  private getSnapshotAtOrBefore/g, "return this.createNoTrade(index, spotPrice, 'NO_TRADE: no valid strategy setup found');\n  }\n\n  private getSnapshotAtOrBefore");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed nulls');
