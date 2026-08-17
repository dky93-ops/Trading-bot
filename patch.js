const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/const optionChainTimestamp = Number\(this\.state\.optionChainTimestamp \|\| 0\);\n\s*if \(\!Number\.isFinite\(optionChainTimestamp\) \|\| optionChainTimestamp <= 0\) \{\n\s*return this\.createNoTrade\(index, spotPrice, 'FAILED_FEED_SYNC: Missing option-chain snapshot timestamp'\);\n\s*\}/g, `
    const syncRes = validateFeedSync({
      candleStart: new Date(lastCompletedCandle.timestamp).getTime(),
      candleClose: completedCandleCloseTimestamp,
      optionSnapshotTimestamp: this.state.optionChainSnapshotTimestamp || 0,
      nowMs: nowMs,
      maxSnapshotLagMs: 15_000
    });
    if (!syncRes.valid) {
      return this.createNoTrade(index, spotPrice, syncRes.reason || 'FAILED_FEED_SYNC');
    }
`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
