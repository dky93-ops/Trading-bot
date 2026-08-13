const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Replace manageActiveTrades loop content
const manageActiveTradesRegex = /const currentOptPrice = Number\(signal\.latestPrice \?\? signal\.optionEntry\);[\s\S]*?continue;\n\s*\}/m;
const newManageActiveTrades = `const currentOptPrice = Number(signal.latestPrice ?? signal.optionEntry);
      const currentSpot = Number(this.state.nifty50.lastPrice);
      const isCall = signal.direction === 'CALL';
      const spotInvalidation = signal.spotInvalidation;

      const structuralInvalidation = isCall
        ? currentSpot <= spotInvalidation
        : currentSpot >= spotInvalidation;
      if (structuralInvalidation) {
        this.closeSignal(signal, currentOptPrice, 'SPOT STRUCTURAL INVALIDATION');
        newSignals.push(signal);
        continue;
      }

      if (currentOptPrice <= signal.optionStoploss) {
        this.closeSignal(signal, signal.optionStoploss, 'OPTION PREMIUM STOPLOSS');
        newSignals.push(signal);
        continue;
      }

      if (
        !signal.firstTargetHitFlag &&
        currentOptPrice >= signal.optionTarget1
      ) {
        signal.firstTargetHitFlag = true;
        signal.optionStoploss = Math.max(signal.optionStoploss, signal.optionEntry);
        signal.stoploss = signal.optionStoploss;
      }

      if (currentOptPrice >= signal.optionTarget2) {
        this.closeSignal(signal, currentOptPrice, 'OPTION PREMIUM TARGET 2');
        newSignals.push(signal);
        continue;
      }

      const optionRisk = signal.optionEntry - signal.optionStoploss;
      if (
        signal.firstTargetHitFlag &&
        optionRisk > 0 &&
        signal.highestPrice > signal.optionEntry
      ) {
        const candidate = Number(
          (signal.highestPrice - optionRisk * 0.5).toFixed(2),
        );
        if (candidate > signal.optionStoploss) {
          signal.optionStoploss = candidate;
          signal.stoploss = candidate;
        }
      }`;

code = code.replace(manageActiveTradesRegex, newManageActiveTrades);

const createNoTradeRegex = /prices: \{\n\s*spotEntry: spot,\n\s*spotInvalidation: 0,\n\s*spotTarget1: 0,\n\s*spotTarget2: 0,\n\s*optionEntry: 0,\n\s*optionStoploss: 0,\n\s*optionTarget1: 0,\n\s*optionTarget2: 0\n\s*\} as any,/m;
const newCreateNoTrade = `prices: {
      spotEntry: spot,
      spotInvalidation: 0,
      spotTarget1: 0,
      spotTarget2: 0,
      optionEntry: 0,
      optionStoploss: 0,
      optionTarget1: 0,
      optionTarget2: 0,
    },
    spotEntry: spot,
    spotInvalidation: 0,
    spotTarget1: 0,
    spotTarget2: 0,
    optionEntry: 0,
    optionStoploss: 0,
    optionTarget1: 0,
    optionTarget2: 0,`;
code = code.replace(createNoTradeRegex, newCreateNoTrade);

// Update mapToPublicDecision
const mapToPublicDecisionRegex = /entry: sig\.optionEntry \|\| sig\.entry \|\| 0,\n\s*stoploss: sig\.optionStoploss \|\| sig\.stoploss \|\| 0,\n\s*target1: sig\.optionTarget1 \|\| sig\.target1 \|\| 0,\n\s*target2: sig\.optionTarget2 \|\| sig\.target2 \|\| 0,\n\s*spot_entry: sig\.spotEntry \|\| 0,\n\s*spot_invalidation: sig\.spotInvalidation \|\| 0,\n\s*spot_target1: sig\.spotTarget1 \|\| 0,\n\s*spot_target2: sig\.spotTarget2 \|\| 0,\n\s*option_entry: sig\.optionEntry \|\| 0,\n\s*option_stoploss: sig\.optionStoploss \|\| 0,\n\s*option_target1: sig\.optionTarget1 \|\| 0,\n\s*option_target2: sig\.optionTarget2 \|\| 0,/m;

const newMapToPublicDecision = `entry: sig.optionEntry || sig.entry || 0,
      stoploss: sig.optionStoploss || sig.stoploss || 0,
      target1: sig.optionTarget1 || sig.target1 || 0,
      target2: sig.optionTarget2 || sig.target2 || 0,
      spot_entry: sig.spotEntry,
      spot_invalidation: sig.spotInvalidation,
      spot_target1: sig.spotTarget1,
      spot_target2: sig.spotTarget2,
      option_entry: sig.optionEntry,
      option_stoploss: sig.optionStoploss,
      option_target1: sig.optionTarget1,
      option_target2: sig.optionTarget2,`;

if (mapToPublicDecisionRegex.test(code)) {
    code = code.replace(mapToPublicDecisionRegex, newMapToPublicDecision);
}

fs.writeFileSync('src/backend/strategy-engine.ts', code);
