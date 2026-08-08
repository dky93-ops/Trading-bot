const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// The messed up part is from line 1162:
// if (!chainRows || chainRows.length < 5) return { wallsAbove, wallsBelow };;
//     const decision: EngineDecision = {
// ...
//     return { decision, internal: internalSig };

const badCode = /if \(\!chainRows \|\| chainRows\.length < 5\) return \{ wallsAbove, wallsBelow \};\;\s*const decision: EngineDecision = \{[\s\S]*?return \{ decision, internal: internalSig \};\s*/;

engine = engine.replace(badCode, 'if (!chainRows || chainRows.length < 5) return { wallsAbove, wallsBelow };\n\n');
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
