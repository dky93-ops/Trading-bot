const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /if \(\n\s*!selectedSignal &&\n\s*this\.settings\.strategies\?\.openingTrap\?\.enabled\n\s*\) \{\n\s*selectedSignal = await this\.checkTechnicalConfluence\(valCtx, index, spotPrice, candles, chainRows, sessState, passed, failed\);\n\n\s*if \(!selectedSignal\) \{/g;

code = code.replace(regex, `selectedSignal = await this.checkTechnicalConfluence(valCtx, index, spotPrice, candles, chainRows, sessState, passedFilters, failedFilters);

    if (
      !selectedSignal &&
      this.settings.strategies?.openingTrap?.enabled
    ) {`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('fixed2');
