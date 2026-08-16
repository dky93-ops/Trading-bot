const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const failedRetestFunction = `
  private async checkFailedRetest(
    direction: 'CALL' | 'PUT',
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sess: LocalSessionState,
    wallAbove: number,
    wallBelow: number,
    passed: string[],
    failed: string[],
  ): Promise<InternalSignal | null> {
    if (candles.length < 4) return null;

    const levels = this.validStructureLevels(sess);
    const buffer = Math.max(
      2,
      Number(this.settings.WALL_TOLERANCE_POINTS || 5),
    );

    const firstBreakIndex = Math.max(1, candles.length - 8);

    for (
      let breakIndex = firstBreakIndex;
      breakIndex < candles.length - 2;
      breakIndex++
    ) {
      const breakCandle = candles[breakIndex];

      for (const level of levels) {
        const breakout =
          direction === 'CALL'
            ? breakCandle.close > level
            : breakCandle.close < level;

        if (!breakout) continue;

        for (
          let retestIndex = breakIndex + 1;
          retestIndex < Math.min(candles.length - 1, breakIndex + 5);
          retestIndex++
        ) {
          const retestCandle = candles[retestIndex];
          const confirmationCandle = candles[retestIndex + 1];

          const validRetest =
            direction === 'CALL'
              ? retestCandle.low <= level + buffer &&
                retestCandle.close > level
              : retestCandle.high >= level - buffer &&
                retestCandle.close < level;

          const confirmed =
            direction === 'CALL'
              ? confirmationCandle.close > confirmationCandle.open &&
                confirmationCandle.close > retestCandle.high
              : confirmationCandle.close < confirmationCandle.open &&
                confirmationCandle.close < retestCandle.low;

          if (!validRetest || !confirmed) continue;

          const option = this.selectStrike(direction, spot, chainRows);
          if (!option) continue;

          const optionType = direction === 'CALL' ? 'CE' : 'PE';

          const premiumAtBreak =
            this.getHistoricalPremium(
              option.strike,
              optionType,
              new Date(breakCandle.timestamp).toISOString(),
            );

          const premiumAtRetestLow =
            this.getHistoricalPremium(
              option.strike,
              optionType,
              new Date(retestCandle.timestamp).toISOString(),
            );

          const premiumAtConfirmation =
            this.getHistoricalPremium(
              option.strike,
              optionType,
              new Date(confirmationCandle.timestamp).toISOString(),
            );

          if (
            premiumAtBreak === undefined ||
            premiumAtRetestLow === undefined ||
            premiumAtConfirmation === undefined
          ) {
            failed.push(
              'FAILED_PREMIUM_ALIGNMENT: failed-retest history incomplete',
            );
            continue;
          }

          const targets = this.computeSpotTargets(
            direction,
            spot,
            level,
            chainRows,
            sess,
          );

          const setup: ProposedSetup = {
            direction,
            level,
            setupType: 'FAILED_RETEST',
            c0: confirmationCandle,
            c1: retestCandle,
            c2: breakCandle,
            target1: targets.target1Spot,
            target2: targets.target2Spot,
            stopLoss: targets.structuralStopSpot,
            breakCandleIndex: breakIndex,
            retestCandleIndex: retestIndex,
            confirmationCandleIndex: retestIndex + 1,
            barsSinceBreakout: retestIndex - breakIndex,
            barsSinceRetest: 1,
            premiumAtBreak,
            premiumAtRetestLow,
            premiumAtConfirmation,
            ceOpt: direction === 'CALL' ? option : undefined,
            peOpt: direction === 'PUT' ? option : undefined,
          };

          if (
            !this.validateCandidate(
              valCtx,
              setup,
              passed,
              failed,
            )
          ) {
            continue;
          }

          return this.createSignal(
            index,
            spot,
            'FAILED_RETEST',
            direction,
            level,
            chainRows,
            sess,
            passed,
            failed,
          );
        }
      }
    }

    return null;
  }
`;

if (!code.includes('private async checkFailedRetest')) {
  code = code.replace('private async checkContinuation(', failedRetestFunction + '\n  private async checkContinuation(');
}

fs.writeFileSync('src/backend/strategy-engine.ts', code);
