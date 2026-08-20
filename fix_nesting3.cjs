const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const target = `    if (
      !selectedSignal &&
      this.settings.strategies?.openingTrap?.enabled
    ) {
      selectedSignal = await this.checkTechnicalConfluence(valCtx, index, spotPrice, candles, chainRows, sessState, passed, failed);

      if (!selectedSignal) {
        selectedSignal = await this.checkOpeningTrap(`;

const replacement = `    selectedSignal = await this.checkTechnicalConfluence(valCtx, index, spotPrice, candles, chainRows, sessState, passedFilters, failedFilters);

    if (
      !selectedSignal &&
      this.settings.strategies?.openingTrap?.enabled
    ) {
        selectedSignal = await this.checkOpeningTrap(`;

code = code.replace(target, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('fixed3');
