const fs = require('fs');

let typesCode = fs.readFileSync('src/backend/types.ts', 'utf8');
if (!typesCode.includes('initialOptionRisk?: number;')) {
  typesCode = typesCode.replace('optionStoploss: number;', 'optionStoploss: number;\n  initialOptionRisk?: number;');
  fs.writeFileSync('src/backend/types.ts', typesCode);
}

let engineCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const targetSessionDate = `const currentDateIST = getISTDateKey(timeObj);
    const sessState = this.sessionStates[index];`;

const replacementSessionDate = `const currentDateIST = timeObj.toLocaleDateString(
      'en-CA',
      { timeZone: 'Asia/Kolkata' },
    );

    let sessState = this.sessionStates[index];

    if (
      !sessState ||
      sessState.sessionDateIST !== currentDateIST
    ) {
      sessState = this.createInitialSessionState();
      sessState.sessionDateIST = currentDateIST;
      this.sessionStates[index] = sessState;
    }`;

engineCode = engineCode.replace(targetSessionDate, replacementSessionDate);

const targetCreateSignal = `optionStoploss: optionRisk > 0 ? (premium - optionRisk).toFixed(2) : undefined,`;
const replacementCreateSignal = `optionStoploss: optionRisk > 0 ? (premium - optionRisk).toFixed(2) : undefined,
      initialOptionRisk: optionRisk,`;
if (engineCode.includes(targetCreateSignal)) {
    engineCode = engineCode.replace(targetCreateSignal, replacementCreateSignal);
}

const targetHighestPrice = `if (curPrice > signal.highestPrice) signal.highestPrice = curPrice;
      if (curPrice < signal.lowestPrice) signal.lowestPrice = curPrice;`;
const replacementHighestPrice = `const currentOptPrice = Number(
        signal.latestPrice ?? signal.optionEntry,
      );

      if (
        currentOptPrice >
        Number(signal.highestPrice ?? signal.optionEntry)
      ) {
        signal.highestPrice = currentOptPrice;
      }
      if (curPrice < signal.lowestPrice) signal.lowestPrice = curPrice;`;
if (engineCode.includes(targetHighestPrice)) {
    engineCode = engineCode.replace(targetHighestPrice, replacementHighestPrice);
}

const targetTrailing = `const risk = signal.optionEntry - signal.optionStoploss;
        if (risk > 0) {
          const candidate = Number((signal.highestPrice - risk * 0.5).toFixed(2));
          if (candidate > signal.optionStoploss) {
            signal.optionStoploss = candidate;
            signal.stoploss = candidate;
          }
        }`;
const replacementTrailing = `const optionRisk = Number(
        signal.initialOptionRisk ??
          signal.optionEntry - signal.optionStoploss,
      );

      if (
        signal.firstTargetHitFlag &&
        optionRisk > 0 &&
        Number(signal.highestPrice) > signal.optionEntry
      ) {
        const candidate = Number(
          (signal.highestPrice - optionRisk * 0.5).toFixed(2),
        );

        if (candidate > signal.optionStoploss) {
          signal.optionStoploss = candidate;
          signal.stoploss = candidate;
        }
      }`;
if (engineCode.includes(targetTrailing)) {
    engineCode = engineCode.replace(targetTrailing, replacementTrailing);
}

const targetCloseRealized = `const realizedPnL = (exitPrice - signal.entryPrice) * (signal.qty || 75);
    signal.realizedPnL = realizedPnL;
    this.realizedPnL += realizedPnL;`;
const replacementCloseRealized = `const realizedPnL =
      exitPrice - (signal.optionEntry || signal.entryPrice);

    signal.realizedPnL = realizedPnL;
    this.realizedPnL += realizedPnL * (signal.qty || 75);`;
if (engineCode.includes(targetCloseRealized)) {
    engineCode = engineCode.replace(targetCloseRealized, replacementCloseRealized);
}

const targetSessTrade = `if (sess) {
      sess.tradeTakenFlag = false;
      sess.lastTradeExitTime = Date.now();`;
const replacementSessTrade = `if (sess) {
      sess.tradeTakenFlag = false;
      sess.lastTradeExitTime = Date.now();
      sess.completedTradesCount =
        (sess.completedTradesCount || 0) + 1;

      if (realizedPnL < 0) {
        sess.consecutiveLosingTrades =
          (sess.consecutiveLosingTrades || 0) + 1;
        sess.consecutiveLosses =
          (sess.consecutiveLosses || 0) + 1;
      } else {
        sess.consecutiveLosingTrades = 0;
        sess.consecutiveLosses = 0;
      }`;
if (engineCode.includes(targetSessTrade)) {
    engineCode = engineCode.replace(targetSessTrade, replacementSessTrade);
}

// Remove any increment of completedTradesCount from signal creation
const targetCreateSignalSess = `sessState.completedTradesCount = (sessState.completedTradesCount || 0) + 1;`;
engineCode = engineCode.replace(targetCreateSignalSess, `sessState.totalTradesToday = (sessState.totalTradesToday || 0) + 1;`);

fs.writeFileSync('src/backend/strategy-engine.ts', engineCode);
