const fs = require('fs');

let rules = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex1 = /export function rule8DominantOIWall\([\s\S]*?return pass\(\);\n\}/;
const replace1 = `export function rule8DominantOIWall(ctx: ValidationContext, setup: ProposedSetup): RuleResult {
  if (setup.setupType !== 'OI_WALL_REJECTION') return pass();
  const chainRows = ctx.chainRows;
  if (!chainRows || chainRows.length < 5) return fail('FAILED_WALL_DOMINANCE: Missing chain data');
  if (!setup.level || setup.level === 0) return fail('FAILED_WALL_DOMINANCE: No valid dominant OI wall found at this level');

  const sortedRows = [...chainRows].sort((a, b) => a.strike_price - b.strike_price);
  const wallRowIndex = sortedRows.findIndex(r => r.strike_price === setup.level);
  
  if (wallRowIndex < 2 || wallRowIndex > sortedRows.length - 3) {
    return fail('FAILED_WALL_DOMINANCE: Strike not found or insufficient surrounding strikes');
  }

  const row = sortedRows[wallRowIndex];
  const surr = [
    sortedRows[wallRowIndex - 2], sortedRows[wallRowIndex - 1], 
    sortedRows[wallRowIndex + 1], sortedRows[wallRowIndex + 2]
  ];

  if (setup.direction === 'PUT') {
    // Rejected from CE Wall above, buying PUT
    const callOI = row.call_options?.market_data?.oi || 0;
    const surrCallOI = surr.reduce((sum, r) => sum + (r.call_options?.market_data?.oi || 0), 0) / 4;
    
    if (surrCallOI === 0 || callOI < 1.5 * surrCallOI) return fail('FAILED_WALL_DOMINANCE: CE OI is not 1.5x dominant');
    
    // Check weakening using session state
    if (ctx.sessState.wallOIWeakeningConfirmed[setup.level]) return fail('FAILED_WALL_DOMINANCE: CE OI is rapidly weakening (>= 5% drop)');
    if (ctx.sessState.wallNegativeOICounts[setup.level] >= 2) return fail('FAILED_WALL_DOMINANCE: CE OI dropped for 2 consecutive ticks');
  } else {
    // Rejected from PE Wall below, buying CALL
    const putOI = row.put_options?.market_data?.oi || 0;
    const surrPutOI = surr.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0) / 4;
    
    if (surrPutOI === 0 || putOI < 1.5 * surrPutOI) return fail('FAILED_WALL_DOMINANCE: PE OI is not 1.5x dominant');

    if (ctx.sessState.wallOIWeakeningConfirmed[setup.level]) return fail('FAILED_WALL_DOMINANCE: PE OI is rapidly weakening (>= 5% drop)');
    if (ctx.sessState.wallNegativeOICounts[setup.level] >= 2) return fail('FAILED_WALL_DOMINANCE: PE OI dropped for 2 consecutive ticks');
  }
  
  return pass();
}`;

rules = rules.replace(regex1, replace1);

const regex2 = /if \(setup\.wallOIWeakeningPercent !== undefined && setup\.wallOIWeakeningPercent < 5 && \(setup\.wallNegativeOIConsecutive \|\| 0\) < 2\) \{\s*return fail\('FAILED_WALL_WEAKENING: OI Wall did not weaken'\);\s*\}/;
rules = rules.replace(regex2, '');

fs.writeFileSync('src/backend/validation-rules.ts', rules);
