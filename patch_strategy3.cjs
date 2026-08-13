const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const stratSelectionRegex = /let selectedSignal = null;\n\s*if \(this\.settings\.strategies\?\.openingTrap\?\.enabled\) \{[\s\S]*?\}\n\s*if \(!selectedSignal && this\.settings\.strategies\?\.oiWallRejection\?\.enabled\) \{[\s\S]*?\}/m;

const newStratSelection = `let selectedSignal = null;
    const isActiveFamily = (family: string) =>
      [...this.activeSignals.values()].some(
        (signal) =>
          signal.index === index &&
          signal.strategy_family === family &&
          signal.status === 'ACTIVE',
      );

    if (
      !selectedSignal &&
      this.settings.strategies?.failedRetest?.enabled &&
      !isActiveFamily('FAILED_RETEST')
    ) {
      selectedSignal = await this.checkFailedRetest(
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passedFilters,
        failedFilters,
      );
    }

    if (
      !selectedSignal &&
      this.settings.strategies?.continuationBreakdown?.enabled &&
      !isActiveFamily('CONTINUATION_BREAKDOWN')
    ) {
      selectedSignal = await this.checkContinuation(
        'CONTINUATION_BREAKDOWN',
        'PUT',
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passedFilters,
        failedFilters,
      );
    }

    if (
      !selectedSignal &&
      this.settings.strategies?.continuationBreakout?.enabled &&
      !isActiveFamily('CONTINUATION_BREAKOUT')
    ) {
      selectedSignal = await this.checkContinuation(
        'CONTINUATION_BREAKOUT',
        'CALL',
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passedFilters,
        failedFilters,
      );
    }

    if (
      !selectedSignal &&
      this.settings.strategies?.openingTrap?.enabled &&
      !isActiveFamily('OPENING_TRAP')
    ) {
      selectedSignal = await this.checkOpeningTrap(
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passedFilters,
        failedFilters,
      );
    }

    if (
      !selectedSignal &&
      this.settings.strategies?.oiWallRejection?.enabled &&
      !isActiveFamily('OI_WALL_REJECTION')
    ) {
      selectedSignal = await this.checkOIWallRejection(
        valCtx,
        index,
        spotPrice,
        candles,
        rows,
        sessState,
        nearestCeWallAbove,
        nearestPeWallBelow,
        passedFilters,
        failedFilters,
      );
    }`;

code = code.replace(stratSelectionRegex, newStratSelection);

const validateRegex = /private validateSetup\([\s\S]*?return true;\n\s*\}/m;
const newValidate = `private validateCandidate(
    valCtx: ValidationContext,
    setup: ProposedSetup,
    passed: string[],
    failed: string[],
  ): boolean {
    const selected = setup.direction === 'CALL' ? setup.ceOpt : setup.peOpt;
    const price = Number(selected?.price);
    const bid = Number(selected?.bidPrice);
    const ask = Number(selected?.askPrice);
    if (!(price > 0)) {
      failed.push('FAILED_LIQUIDITY: selected option premium unavailable');
      return false;
    }
    if (bid > 0 && ask >= bid) {
      const spreadPercent = ((ask - bid) / price) * 100;
      if (spreadPercent > (this.settings.MAX_OPTION_SPREAD_PERCENT || 1.5)) {
        failed.push(\`FAILED_LIQUIDITY: spread \${spreadPercent.toFixed(2)}% too large\`);
        return false;
      }
      setup.spreadPercent = spreadPercent;
    } else {
      failed.push('FAILED_LIQUIDITY: valid bid/ask unavailable');
      return false;
    }

    const levels = this.validStructureLevels(valCtx.sessState);
    const result = runSetupValidation(
      valCtx,
      setup,
      [...levels, setup.level],
      setup.wallTestCount || 0,
    );
    if (!result.passed) {
      failed.push(result.reason || 'FAILED_SETUP_VALIDATION');
      return false;
    }
    passed.push(\`Validated \${setup.setupType} with real premium/OI history\`);
    return true;
  }`;

code = code.replace(validateRegex, newValidate);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
