const fs = require('fs');

let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
valCode = valCode.replace(/nearestCEWallAbove:/g, "nearestCeWallAbove:");
valCode = valCode.replace(/nearestPEWallBelow:/g, "nearestPeWallBelow:");
valCode = valCode.replace(/ctx\.nearestCEWallAbove/g, "ctx.nearestCeWallAbove");
valCode = valCode.replace(/ctx\.nearestPEWallBelow/g, "ctx.nearestPeWallBelow");
valCode = valCode.replace(/activeInternalSignals:/g, "activeSignals:"); // Keep only activeSignals

fs.writeFileSync('src/backend/validation-rules.ts', valCode);
