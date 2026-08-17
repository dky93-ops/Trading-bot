const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(/    const feedDeltaMs = Math\.abs\(\(this\.state\.optionChainSnapshotTimestamp \|\| 0\) - completedCandleCloseTimestamp\);\n\n    const feedDeltaMs = Math\.abs\(\(this\.state\.optionChainSnapshotTimestamp \|\| 0\) - completedCandleCloseTimestamp\);\n    const feedSyncConfidencePenalty = feedDeltaMs > 5_000 \? 5 : 0;/g, `
    const feedDeltaMs = Math.abs((this.state.optionChainSnapshotTimestamp || 0) - completedCandleCloseTimestamp);
    const feedSyncConfidencePenalty = feedDeltaMs > 5_000 ? 5 : 0;`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
