const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/if \(this\.settings\.strategies\?\.openingTrap\?\.enabled\) \{[\s\S]*?selectedSignal = await this\.checkTechnicalConfluence\(valCtx, index, spotPrice, candles, chainRows, sessState, passed, failed\);[\s\S]*?if \(!selectedSignal\) \{[\s\S]*?selectedSignal = await this\.checkOpeningTrap\(/, 
`selectedSignal = await this.checkTechnicalConfluence(valCtx, index, spotPrice, candles, chainRows, sessState, passedFilters, failedFilters);

    if (!selectedSignal && this.settings.strategies?.openingTrap?.enabled) {
      selectedSignal = await this.checkOpeningTrap(`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('fixed');
