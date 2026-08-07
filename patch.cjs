const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// The block to replace
const badFailureMemory = `      // Update failure memory for ALL failed setups
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

      // Reclaim-specific memory updates
      if (result.reason && result.reason.includes('FAILED_RECLAIMED_LEVEL')) {
        localSess.brokenLevelUnderWatch = null;
      }`;

const fixFailureMemory = `      // Reclaim-specific memory updates
      if (result.reason && result.reason.includes('FAILED_RECLAIMED_LEVEL')) {
        localSess.brokenLevelUnderWatch = null;
        localSess.failedLevelsToday = localSess.failedLevelsToday || [];
        if (!localSess.failedLevelsToday.includes(setup.level)) {
          localSess.failedLevelsToday.push(setup.level);
        }
      }`;

code = code.replace(badFailureMemory, fixFailureMemory);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
