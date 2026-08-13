const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /if \(result\.reason && result\.reason\.includes\('FAILED_RECLAIMED_LEVEL'\)\) \{[\s\S]*?\}\n      return false;/m;

const replacement = `if (result.reason && result.reason.includes('FAILED_RECLAIMED_LEVEL')) {
        localSess.brokenLevelUnderWatch = null;
        localSess.retestPendingFlag = false;
        localSess.continuationPendingFlag = false;
        if (localSess.activeStructureId === setup.structureId) {
          localSess.activeStructureId = null;
        }
      }
      localSess.failedStructuresToday = localSess.failedStructuresToday || [];
      if (setup.structureId && !localSess.failedStructuresToday.includes(setup.structureId)) {
         localSess.failedStructuresToday.push(setup.structureId);
      }
      return false;`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 6 validate failure block complete');
