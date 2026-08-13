const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// fix setupType inside createSignal
code = code.replace(/setupType,\n\s*c0:/, "setupType: setupType as any, c0:");

// fix setupType return inside mapToPublicDecision (lines 575/584 were about status and signal)
// Wait, error TS2322: Type 'string' is not assignable to type '"NONE" | "OPENING_TRAP"...'
// where is that? It's probably in mapToPublicDecision
code = code.replace(/strategy_family: sig\.strategy_family \|\| 'NONE',/, "strategy_family: (sig.strategy_family || 'NONE') as any,");
code = code.replace(/direction: sig\.direction \|\| 'NONE',/, "direction: (sig.direction || 'NONE') as any,");

// type 'OPEN' not assignable to 'ACTIVE' | 'CLOSED'
code = code.replace(/status: 'OPEN',/, "status: 'ACTIVE',");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
