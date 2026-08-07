const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

// RULE 2
const oldR2 = `// RULE 2
export function rule2OpeningFilter(timeStr: string, setup?: ProposedSetup): RuleResult {
  if (timeStr < '09:15') return fail('FAILED_TIME_FILTER: Pre-market');
  if (timeStr >= '15:30') return fail('FAILED_TIME_FILTER: Post-market');
  if (timeStr >= '09:15' && timeStr < '09:20') {
    if (!setup) return pass(); // Allow pre-checks to pass
    // Only allow if fully confirmed (if it reached here it is)
  }
  return pass();
}`;

const newR2 = `// RULE 2
export function rule2OpeningFilter(timeStr: string, setup?: ProposedSetup): RuleResult {
  if (timeStr < '09:15') return fail('FAILED_TIME_FILTER: Pre-market');
  if (timeStr >= '15:30') return fail('FAILED_TIME_FILTER: Post-market');
  if (timeStr < '09:20' && !setup) {
    // Soft gate: don't block pre-checks, but require full setup confirmation
    return pass(); 
  }
  if (timeStr < '09:20' && setup) {
    // Exceptional clarity required
    if (!setup.c0 || !setup.c1) return fail('FAILED_TIME_FILTER: Pre-09:20 requires exceptional clarity (missing candles)');
  }
  return pass();
}`;

code = code.replace(oldR2, newR2);

// RULE 8
const oldR8 = `// RULE 8
export function rule8DominantOIWall(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType !== 'OI_WALL_REJECTION') return pass();
  const chainRows = ctx.chainRows;
  if (!chainRows || chainRows.length < 5) return fail('FAILED_DOMINANT_WALL: Missing chain data');
  if (!setup.level || setup.level === 0) return fail('FAILED_DOMINANT_WALL: No valid dominant OI wall found at this level');

  const sortedRows = [...chainRows].sort((a, b) => a.strike_price - b.strike_price);
  const wallRowIndex = sortedRows.findIndex(r => r.strike_price === setup.level);
  
  if (wallRowIndex < 2 || wallRowIndex > sortedRows.length - 3) {
    return fail('FAILED_DOMINANT_WALL: Strike not found or insufficient surrounding strikes');
  }

  const row = sortedRows[wallRowIndex];
  const surr = [
    sortedRows[wallRowIndex - 2], sortedRows[wallRowIndex - 1], 
    sortedRows[wallRowIndex + 1], sortedRows[wallRowIndex + 2]
  ];

  if (setup.direction === 'PUT') {
    const callOI = row.call_options?.market_data?.oi || 0;
    const callOIChange = row.call_options?.market_data?.oi_change || 0;
    const surrCallOI = surr.reduce((sum, r) => sum + (r.call_options?.market_data?.oi || 0), 0) / 4;
    
    if (surrCallOI === 0 || callOI < 1.5 * surrCallOI) return fail('FAILED_DOMINANT_WALL: CE OI is not 1.5x dominant');
    if (callOIChange < -0.05 * callOI) return fail('FAILED_DOMINANT_WALL: CE OI is rapidly reversing');
  } else {
    const putOI = row.put_options?.market_data?.oi || 0;
    const putOIChange = row.put_options?.market_data?.oi_change || 0;
    const surrPutOI = surr.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0) / 4;
    
    if (surrPutOI === 0 || putOI < 1.5 * surrPutOI) return fail('FAILED_DOMINANT_WALL: PE OI is not 1.5x dominant');
    if (putOIChange < -0.05 * putOI) return fail('FAILED_DOMINANT_WALL: PE OI is rapidly reversing');
  }
  
  const testCount = ctx.sessState.wallTestCounts[setup.level] || 0;
  if (testCount < 1) {
    return fail('FAILED_DOMINANT_WALL: Wall has not been tested in the current session');
  }

  return pass();
}`;

const newR8 = `// RULE 8
export function rule8DominantOIWall(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType !== 'OI_WALL_REJECTION') return pass();
  const chainRows = ctx.chainRows;
  if (!chainRows || chainRows.length < 5) return fail('FAILED_DOMINANT_WALL: Missing chain data');
  if (!setup.level || setup.level === 0) return fail('FAILED_DOMINANT_WALL: No valid dominant OI wall found at this level');

  const sortedRows = [...chainRows].sort((a, b) => a.strike_price - b.strike_price);
  const wallRowIndex = sortedRows.findIndex(r => r.strike_price === setup.level);
  
  if (wallRowIndex < 2 || wallRowIndex > sortedRows.length - 3) {
    return fail('FAILED_DOMINANT_WALL: Strike not found or insufficient surrounding strikes');
  }

  const row = sortedRows[wallRowIndex];
  const surr = [
    sortedRows[wallRowIndex - 2], sortedRows[wallRowIndex - 1], 
    sortedRows[wallRowIndex + 1], sortedRows[wallRowIndex + 2]
  ];

  // For PUT, we buy PUT when rejecting off a CE wall (resistance)
  if (setup.direction === 'PUT') {
    const callOI = row.call_options?.market_data?.oi || 0;
    const callOIChange = row.call_options?.market_data?.oi_change || 0;
    const surrCallOI = surr.reduce((sum, r) => sum + (r.call_options?.market_data?.oi || 0), 0) / 4;
    
    if (surrCallOI === 0 || callOI < 1.5 * surrCallOI) return fail('FAILED_DOMINANT_WALL: CE OI is not 1.5x dominant');
    if (callOIChange < -0.05 * callOI) return fail('FAILED_DOMINANT_WALL: CE OI is rapidly reversing');
  } else {
    // For CALL, we buy CALL when rejecting off a PE wall (support)
    const putOI = row.put_options?.market_data?.oi || 0;
    const putOIChange = row.put_options?.market_data?.oi_change || 0;
    const surrPutOI = surr.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0) / 4;
    
    if (surrPutOI === 0 || putOI < 1.5 * surrPutOI) return fail('FAILED_DOMINANT_WALL: PE OI is not 1.5x dominant');
    if (putOIChange < -0.05 * putOI) return fail('FAILED_DOMINANT_WALL: PE OI is rapidly reversing');
  }
  
  // Use the actual strike for the test count
  const testCount = ctx.sessState.wallTestCounts[setup.level] || 0;
  if (testCount < 2) {
    return fail('FAILED_DOMINANT_WALL: Wall must be tested at least 2 times for OI_WALL_REJECTION');
  }

  return pass();
}`;

code = code.replace(oldR8, newR8);

fs.writeFileSync('src/backend/validation-rules.ts', code);
