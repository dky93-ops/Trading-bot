const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const badReclaim = `      // Reclaim-specific memory updates
      if (result.reason && result.reason.includes('FAILED_RECLAIMED_LEVEL')) {
        localSess.brokenLevelUnderWatch = null;
        localSess.retestPendingFlag = false;
        localSess.continuationPendingFlag = false;
        if (localSess.activeStructureId === setup.structureId) {
          localSess.activeStructureId = null;
        }
      }`;

const fixReclaim = `      // Reclaim-specific memory updates
      if (result.reason && result.reason.includes('FAILED_RECLAIMED_LEVEL')) {
        localSess.brokenLevelUnderWatch = null;
        localSess.retestPendingFlag = false;
        localSess.continuationPendingFlag = false;
        if (localSess.activeStructureId === setup.structureId) {
          localSess.activeStructureId = null;
        }
        
        localSess.failedLevelsToday = localSess.failedLevelsToday || [];
        if (!localSess.failedLevelsToday.includes(setup.level)) {
          localSess.failedLevelsToday.push(setup.level);
        }
        localSess.failedStructuresToday = localSess.failedStructuresToday || [];
        if (setup.structureId && !localSess.failedStructuresToday.includes(setup.structureId)) {
          localSess.failedStructuresToday.push(setup.structureId);
        }
        localSess.lastFailedSetupLevel = setup.level;
        localSess.lastFailedStructureId = setup.structureId || null;
      }`;

code = code.replace(badReclaim, fixReclaim);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
