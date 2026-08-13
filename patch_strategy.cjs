const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Initialize wall history
const initSessionRegex = /wallTestCandleKeys: \{\},\n\s*wallReactionCandleKeys: \{\},/;
code = code.replace(initSessionRegex, 'wallTestCandleKeys: {},\n    wallReactionCandleKeys: {},\n    wallOiHistory: {},\n    wallStableByKey: {},');

const insertAfterClass = /export class StrategyEngine \{/;
const newHelpers = `export class StrategyEngine {
  private wallHistoryKey(side: 'CE' | 'PE', strike: number): string {
    const expiry = this.settings.expiryDate || 'CURRENT';
    return \`\${expiry}|\${side}|\${strike}\`;
  }

  private readRequiredOi(row: any, side: 'CE' | 'PE'): number | undefined {
    const md = side === 'CE'
      ? row?.call_options?.market_data
      : row?.put_options?.market_data;
    const value = Number(md?.oi ?? md?.total_oi ?? md?.totalOi);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  private recordWallOi(side: 'CE' | 'PE', strike: number, currentOi: number, snapshotTimestamp: number, sess: LocalSessionState): void {
    if (!Number.isFinite(currentOi) || currentOi < 0) return;
    const key = this.wallHistoryKey(side, strike);
    if (!sess.wallOiHistory) sess.wallOiHistory = {};
    if (!sess.wallStableByKey) sess.wallStableByKey = {};
    const values = sess.wallOiHistory[key] || [];
    const last = values[values.length - 1];

    if (last !== undefined && last === currentOi) return;
    values.push(currentOi);
    sess.wallOiHistory[key] = values.slice(-20);

    const peak = Math.max(...sess.wallOiHistory[key]);
    sess.wallStableByKey[key] = currentOi >= peak * 0.95;
  }
`;

code = code.replace(insertAfterClass, newHelpers);

// replace getOI
const getOIRegex = /const getOI = \(row: any, side: 'CE' \| 'PE'\): number => \{\n\s*const md = side === 'CE' \? row\.call_options\?\.market_data : row\.put_options\?\.market_data;\n\s*return Number\(md\?\.oi \?\? md\?\.total_oi \?\? md\?\.totalOi \?\? 0\);\n\s*\};/g;

code = code.replace(getOIRegex, "const getOI = (row: any, side: 'CE' | 'PE'): number | undefined => this.readRequiredOi(row, side);");


// Replace candidate wall loop check
const candidateWallRegex = /const centerOi = getOI\(row, side\);\n\s*const surroundingOi = \[\n\s*getOI\(rows\[i - 2\], side\),\n\s*getOI\(rows\[i - 1\], side\),\n\s*getOI\(rows\[i \+ 1\], side\),\n\s*getOI\(rows\[i \+ 2\], side\)\n\s*\];\n\s*const averageOi = surroundingOi\.reduce\(\(a, b\) => a \+ b, 0\) \/ 4;\n\s*if \(!\(averageOi > 0\) \|\| centerOi < averageOi \* \(this\.settings\.WALL_OI_RATIO \|\| 1\.5\)\) \{\n\s*continue;\n\s*\}/m;

const newCandidateWall = `const centerOi = getOI(row, side);
        const surroundingOi = [
          getOI(rows[i - 2], side),
          getOI(rows[i - 1], side),
          getOI(rows[i + 1], side),
          getOI(rows[i + 2], side),
        ];

        if (
          centerOi === undefined ||
          surroundingOi.some((value) => value === undefined)
        ) {
          continue;
        }

        const averageOi =
          surroundingOi.reduce((sum, value) => sum + (value as number), 0) / 4;
        if (!(averageOi > 0) || centerOi < averageOi * (this.settings.WALL_OI_RATIO || 1.5)) {
          continue;
        }`;

code = code.replace(candidateWallRegex, newCandidateWall);

const recordWallRegex = /candidates\.candidateCEWallsList\.push\(\{ strike, oi: centerOi \}\);/g;
code = code.replace(recordWallRegex, `candidates.candidateCEWallsList.push({ strike, oi: centerOi });\n        this.recordWallOi('CE', strike, centerOi, Number(this.state.optionChainTimestamp || Date.now()), sess);`);

const recordPEWallRegex = /candidates\.candidatePEWallsList\.push\(\{ strike, oi: centerOi \}\);/g;
code = code.replace(recordPEWallRegex, `candidates.candidatePEWallsList.push({ strike, oi: centerOi });\n        this.recordWallOi('PE', strike, centerOi, Number(this.state.optionChainTimestamp || Date.now()), sess);`);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
