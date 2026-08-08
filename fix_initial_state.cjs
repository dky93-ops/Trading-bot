const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /private createInitialSessionState\(\) \{[\s\S]*?return \{[\s\S]*?lastTradeCandleTime: null,[\s\S]*?\};\n  \}/;

const replacement = `private createInitialSessionState() {
    return {
      sessionHigh: 0,
      sessionLow: Infinity,
      previousDayHigh: 0,
      previousDayLow: 0,
      openingRangeHigh: 0,
      openingRangeLow: 0,
      nearestCeWallAbove: 0,
      nearestPeWallBelow: 0,
      brokenLevelUnderWatch: null,
      retestPendingFlag: false,
      continuationPendingFlag: false,
      tradeTakenFlag: false,
      firstTargetHitFlag: false,
      trailingStopActiveFlag: false,
      lastSignalDirection: 'NONE' as const,
      lastFailedSetupLevel: null,
      failedLevelsToday: [],
      tradedStructures: [],
      failedStructuresToday: [],
      activeStructureId: null,
      lastFailedStructureId: null,
      sessionDateIST: new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' }),
      wallTestCounts: {},
      prevWallTotalOI: {},
      wallNegativeOICounts: {},
      lastTradeExitTime: 0,
      lastTradeCandleTime: null,
      wallTestCandleKeys: {},
      wallReactionCandleKeys: {},
      wallLastSeenOI: {},
      wallOIWeakeningConfirmed: {},
      confirmedBreakoutTimestamp: null,
      confirmedBreakoutLevel: null,
      confirmedBreakoutDirection: null,
      retestTimestamp: null,
      retestLevel: null,
      retestDirection: null,
      lastProcessedCandleTimestamp: null,
      currentStrategyFamily: null,
      lastConfirmedReclaimLevel: null
    };
  }`;

engine = engine.replace(regex, replacement);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
