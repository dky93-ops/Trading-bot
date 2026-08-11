const fs = require('fs');

let typesCode = fs.readFileSync('src/backend/types.ts', 'utf8');

typesCode = typesCode.replace(
  /export interface OptionData \{/,
  "export interface OptionData {\n  bidPrice?: number;\n  askPrice?: number;\n  bidQty?: number;\n  askQty?: number;"
);

// Add missing props to ProposedSetup
typesCode = typesCode.replace(
  /export interface ProposedSetup \{/,
  "export interface ProposedSetup {\n  rewardToRiskTarget1?: number;\n  rewardToRiskTarget2?: number;\n  premiumExpansionPercent?: number;\n  oiWeakeningPercent?: number;\n  spreadPercent?: number;\n  ivFavorable?: boolean;\n  strongMomentum?: boolean;\n  gapRulePassed?: boolean;\n  outsidePreferredWindow?: boolean;\n  expiryDayAfter14?: boolean;\n  feedSyncPenalty?: number;\n  confidence?: number;\n  premiumAtBreak?: number;\n  premiumAtRetestLow?: number;\n  premiumBreakLow?: number;\n  premiumBreakMidpoint?: number;\n  premiumPauseLow?: number;\n  premiumConfirmationClose?: number;\n  premiumConfirmationHigh?: number;\n  premiumConfirmationLow?: number;\n  oppositePremiumConfirmationClose?: number;\n  ivSeriesLast5?: number[];\n  callPremiumSeriesLast5?: number[];\n  putPremiumSeriesLast5?: number[];"
);

// Add missing props to InternalSignal
typesCode = typesCode.replace(
  /export interface InternalSignal extends EngineDecision \{/,
  "export interface InternalSignal extends EngineDecision {\n  structuralStopSpot?: number;\n  target1Spot?: number;\n  target2Spot?: number;\n  entrySpot?: number;\n  initialRiskSpot?: number;"
);

// Add missing props to StrategySessionState
typesCode = typesCode.replace(
  /export interface StrategySessionState \{/,
  "export interface StrategySessionState {\n  wallPeakOI?: Record<number, number>;\n  wallNegativeOIAlignedKeys?: Record<number, string[]>;\n  wallInvalidForRejection?: Record<number, boolean>;"
);

fs.writeFileSync('src/backend/types.ts', typesCode);

let upstoxCode = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');
const fetchRegex = /const price = Number\(m\.ltp \?\? 0\);\n\s*return \{\n\s*price,\n\s*instrumentKey: optObj\.instrument_key,\n\s*strike: targetStrike,\n\s*\};/;

const fetchReplacement = `const price = Number(m.ltp ?? 0);
      return {
        price,
        instrumentKey: optObj.instrument_key,
        strike: targetStrike,
        bidPrice: Number(m.bid_price ?? 0),
        askPrice: Number(m.ask_price ?? 0),
        bidQty: Number(m.bid_qty ?? 0),
        askQty: Number(m.ask_qty ?? 0),
        volume: Number(m.volume ?? 0),
        iv: Number(optObj.option_greeks?.iv ?? 0)
      };`;

upstoxCode = upstoxCode.replace(fetchRegex, fetchReplacement);

// Fix createInitialSessionState
upstoxCode = upstoxCode.replace(
  /wallOIWeakeningConfirmed: \{\},/,
  "wallOIWeakeningConfirmed: {},\n      wallPeakOI: {},\n      wallNegativeOIAlignedKeys: {},\n      wallInvalidForRejection: {},"
);

fs.writeFileSync('src/backend/upstox-service.ts', upstoxCode);
console.log('Types and upstox patched');
