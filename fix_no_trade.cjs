const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /\/\/ NO_TRADE Decision Output[\s\S]*?\} as any;/;
engine = engine.replace(regex, `// NO_TRADE Decision Output
    const reasons = [
      \`No valid high-probability strategy signal found on \${index}.\`,
      failedFilters.length > 0 ? \`Failed filter checks: \${failedFilters.join('; ')}\` : 'Awaiting clean breakout/retest structure and OI confirmation.'
    ];
    const noTradeSig = this.createNoTrade(index, spotPrice, reasons.join(' | '));
    noTradeSig.fake_signal_filters_passed = passedFilters;
    noTradeSig.fake_signal_filters_failed = failedFilters;
    return noTradeSig;`);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
