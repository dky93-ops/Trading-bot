const fs = require('fs');

let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
valCode = valCode.replace(/export interface ValidationContext \{/g, 
`export interface ValidationContext {
  activeSignals?: Map<string, InternalSignal>;`);
fs.writeFileSync('src/backend/validation-rules.ts', valCode);

let typesCode = fs.readFileSync('src/backend/types.ts', 'utf8');
typesCode = typesCode.replace(/isStraddle\?: boolean;/g, 
`isStraddle?: boolean;
  firstTargetHitFlag?: boolean;
  trailingStopActiveFlag?: boolean;`);
fs.writeFileSync('src/backend/types.ts', typesCode);
