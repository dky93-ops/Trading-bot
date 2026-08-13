const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const selectedType: 'CE' \| 'PE' = direction === 'CALL' \? 'CE' : 'PE';/m;

const replacement = `if (structureId && valCtx.sessState.failedStructuresToday && valCtx.sessState.failedStructuresToday.includes(structureId)) {
      failed.push(\`FAILED_STRUCTURE: Structure \${structureId} already failed today\`);
      return false;
    }
    const selectedType: 'CE' | 'PE' = direction === 'CALL' ? 'CE' : 'PE';`;

code = code.replace(regex, replacement);

const regex2 = /failedFilters\.push\(\`FAILED_CONFIDENCE: deterministic confidence \$\{confidence\} < 50\`\);\n\s*return null;/m;
const replacement2 = `failedFilters.push(\`FAILED_CONFIDENCE: deterministic confidence \${confidence} < 50\`);
      if (structureId) {
        if (!sessState.failedStructuresToday) sessState.failedStructuresToday = [];
        if (!sessState.failedStructuresToday.includes(structureId)) sessState.failedStructuresToday.push(structureId);
      }
      return null;`;

code = code.replace(regex2, replacement2);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 6 failed structure block complete');
