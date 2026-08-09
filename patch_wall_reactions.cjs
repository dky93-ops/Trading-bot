const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

function patchRecordWallReactions() {
  const startIndex = code.indexOf('private recordWallReactions(');
  if (startIndex === -1) return;
  const endIndex = code.indexOf('private getValidatedOIWalls(', startIndex);
  if (endIndex === -1) return;
  
  const newFunc = `private recordWallReactions(
    candidates: { candidateCEWallsList: OIWall[], candidatePEWallsList: OIWall[] },
    candles: Candle[],
    step: number,
    sess: LocalSessionState
  ) {
    if (!candles || candles.length < 2) return;

    // Use completed candles only (all except the last one which is forming)
    const completedCandles = candles.slice(0, candles.length - 1);

    const recordWallEvent = (wall: OIWall, isAbove: boolean) => {
      const strike = wall.strike;

      if (!sess.wallTestCandleKeys[strike]) sess.wallTestCandleKeys[strike] = [];
      if (!sess.wallReactionCandleKeys[strike]) sess.wallReactionCandleKeys[strike] = [];

      for (const candle of completedCandles) {
        const candleKey = this.getCompletedCandleKey(candle);

        // CE resistance reaction: candle high reaches/touches the wall, candle close remains below the wall
        // PE support reaction: candle low reaches/touches the wall, candle close remains above the wall
        const touchedWall = isAbove
          ? candle.high >= strike && candle.close < strike
          : candle.low <= strike && candle.close > strike;

        if (touchedWall) {
          if (!sess.wallTestCandleKeys[strike].includes(candleKey)) {
            sess.wallTestCandleKeys[strike].push(candleKey);
            sess.wallTestCounts[strike] = sess.wallTestCandleKeys[strike].length;
          }

          if (!sess.wallReactionCandleKeys[strike].includes(candleKey)) {
            sess.wallReactionCandleKeys[strike].push(candleKey);
          }
        }
      }
    };

    for (const wall of candidates.candidateCEWallsList) recordWallEvent(wall, true);
    for (const wall of candidates.candidatePEWallsList) recordWallEvent(wall, false);
  }

  `;
  
  code = code.substring(0, startIndex) + newFunc + code.substring(endIndex);
}

patchRecordWallReactions();
fs.writeFileSync('src/backend/strategy-engine.ts', code);
