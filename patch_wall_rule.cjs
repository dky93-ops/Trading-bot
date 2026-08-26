const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

const oldWallRule = `export function rule8DominantOIWall(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType !== 'OI_WALL_REJECTION') return pass();
  const chainRows = ctx.chainRows;
  if (!chainRows || chainRows.length < 5) return fail('FAILED_WALL_DOMINANCE: Missing chain data');
  if (!setup.level || setup.level === 0) return fail('FAILED_WALL_DOMINANCE: No valid dominant OI wall found at this level');
  
  const sortedRows = [...chainRows].sort((a, b) => Number(a.strike_price) - Number(b.strike_price));
  const wallRowIndex = sortedRows.findIndex(r => Number(r.strike_price) === setup.level);
  
  if (wallRowIndex < 2 || wallRowIndex > sortedRows.length - 3) {
    return fail('FAILED_WALL_DOMINANCE: Strike not found or insufficient surrounding strikes');
  }

  const row = sortedRows[wallRowIndex];
  const surr = [
    sortedRows[wallRowIndex - 2], sortedRows[wallRowIndex - 1], 
    sortedRows[wallRowIndex + 1], sortedRows[wallRowIndex + 2]
  ];

  const readRequiredOi = (r: any, side: 'CE' | 'PE'): number | undefined => {
    const md = side === 'CE'
      ? r.call_options?.market_data
      : r.put_options?.market_data;
    const value = Number(md?.oi ?? md?.total_oi ?? md?.totalOi);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };

  const side = setup.direction === 'PUT' ? 'CE' : 'PE';
  const wallOi = readRequiredOi(row, side);
  
  const surrOIs = surr.map(r => readRequiredOi(r, side));
  if (wallOi === undefined || surrOIs.some(oi => oi === undefined)) {
    return fail('FAILED_WALL_DOMINANCE: Missing required OI for wall check');
  }

  const avgSurr = surrOIs.reduce((sum, oi) => sum + oi, 0) / 4;
  if (avgSurr === 0 || wallOi < 1.5 * avgSurr) {
    return fail('FAILED_WALL_DOMINANCE: Wall OI is not 1.5x dominant');
  }

  const recentPeak = Number(ctx.sessState.wallPeakOI?.[setup.level]);
  const current = wallOi;
  (setup as any).wallStable = Number.isFinite(recentPeak) && Number.isFinite(current) && current >= recentPeak * 0.95;

  return pass();
}`;

const newWallRule = `export function rule8DominantOIWall(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType !== 'OI_WALL_REJECTION') return pass();
  const chainRows = ctx.chainRows;
  if (!chainRows || chainRows.length < 5) return fail('FAILED_WALL_DOMINANCE: Missing chain data');
  if (!setup.level || setup.level === 0) return fail('FAILED_WALL_DOMINANCE: No valid dominant OI wall found at this level');
  
  const sortedRows = [...chainRows].sort((a, b) => Number(a.strike_price) - Number(b.strike_price));
  const wallRowIndex = sortedRows.findIndex(r => Number(r.strike_price) === setup.level);
  
  if (wallRowIndex === -1) {
    return fail('FAILED_WALL_DOMINANCE: Strike not found');
  }

  const row = sortedRows[wallRowIndex];

  const readRequiredOi = (r: any, side: 'CE' | 'PE'): number | undefined => {
    const md = side === 'CE'
      ? r.call_options?.market_data
      : r.put_options?.market_data;
    const value = Number(md?.oi ?? md?.total_oi ?? md?.totalOi);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };

  const side = setup.direction === 'PUT' ? 'CE' : 'PE';
  const wallOi = readRequiredOi(row, side);
  
  if (wallOi === undefined) {
    return fail('FAILED_WALL_DOMINANCE: Missing required OI for wall check');
  }

  const allOIs = chainRows.map(r => readRequiredOi(r, side)).filter(oi => oi !== undefined && oi > 0) as number[];
  allOIs.sort((a, b) => a - b);
  
  if (allOIs.length === 0) {
    return fail('FAILED_WALL_DOMINANCE: No valid OI in chain');
  }
  
  let count = 0;
  for (const x of allOIs) if (x <= wallOi) count++;
  const pctRank = (count / allOIs.length) * 100;
  
  const percentileThreshold = Number(ctx.settings?.WALL_OI_PERCENTILE || 90);

  if (pctRank < percentileThreshold) {
    return fail(\`FAILED_WALL_DOMINANCE: Wall OI percentile (\${pctRank.toFixed(1)}%) is below threshold (\${percentileThreshold}%)\`);
  }

  const recentPeak = Number(ctx.sessState.wallPeakOI?.[setup.level]);
  const current = wallOi;
  (setup as any).wallStable = Number.isFinite(recentPeak) && Number.isFinite(current) && current >= recentPeak * 0.95;

  return pass();
}`;

if (code.includes('if (avgSurr === 0 || wallOi < 1.5 * avgSurr) {')) {
  code = code.replace(oldWallRule, newWallRule);
  fs.writeFileSync('src/backend/validation-rules.ts', code);
  console.log('patched rule8DominantOIWall');
} else {
  console.log('Could not find oldWallRule snippet in validation-rules.ts');
}
