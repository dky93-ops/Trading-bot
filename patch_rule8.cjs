const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

const replacement = `  const percentileThreshold = Number(ctx.settings?.WALL_OI_PERCENTILE || 90);

  if (pctRank < percentileThreshold) {
    return fail(\`FAILED_WALL_DOMINANCE: Wall OI percentile (\${pctRank.toFixed(1)}%) is below threshold (\${percentileThreshold}%)\`);
  }

  // OI Velocity Check (15 min)
  const history = ctx.sessState.wallOIHistory?.[setup.level];
  if (history && history.length > 0) {
    const now = Date.now();
    const min15Ago = now - 15 * 60 * 1000;
    // Find closest to 15 mins ago
    let oldOI = null;
    let minDiff = Infinity;
    for (const entry of history) {
      if (entry.time <= min15Ago) {
         oldOI = entry.oi;
      }
    }
    if (oldOI) {
      const velocity = ((wallOi - oldOI) / oldOI) * 100;
      if (velocity < -5) {
        return fail('FAILED_OI_VELOCITY: Wall is actively unwinding, breakout imminent');
      }
    }
  }

  const recentPeak = Number(ctx.sessState.wallPeakOI?.[setup.level]);`;

code = code.replace(`  const percentileThreshold = Number(ctx.settings?.WALL_OI_PERCENTILE || 90);

  if (pctRank < percentileThreshold) {
    return fail(\`FAILED_WALL_DOMINANCE: Wall OI percentile (\${pctRank.toFixed(1)}%) is below threshold (\${percentileThreshold}%)\`);
  }

  const recentPeak = Number(ctx.sessState.wallPeakOI?.[setup.level]);`, replacement);

fs.writeFileSync('src/backend/validation-rules.ts', code);
