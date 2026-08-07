const fs = require('fs');

let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
valCode = valCode.replace(/activeSignals\?: Map\<string, InternalSignal\>;/g, "");
valCode = valCode.replace(/activeSignals: Map\<string, InternalSignal\>;/g, "");
valCode = valCode.replace(/export interface ValidationContext \{/g, 
`export interface ValidationContext {
  activeSignals: Map<string, InternalSignal>;`);
valCode = valCode.replace(/activeInternalSignals/g, "activeSignals");
fs.writeFileSync('src/backend/validation-rules.ts', valCode);

let stratCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
stratCode = stratCode.replace(/activeInternalSignals:/g, "activeSignals:");
stratCode = stratCode.replace(/nearestCEWallAbove/g, "nearestCeWallAbove");
stratCode = stratCode.replace(/nearestPEWallBelow/g, "nearestPeWallBelow");
fs.writeFileSync('src/backend/strategy-engine.ts', stratCode);

