const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
let types = fs.readFileSync('src/backend/types.ts', 'utf8');

// Fix exitReason in types
if (!types.includes('exitReason?: string;')) {
    types = types.replace(/status: 'ACTIVE' \| 'CLOSED';/, "status: 'ACTIVE' | 'CLOSED';\n  exitReason?: string;");
}
// Fix instrumentKey in EngineDecision
if (!types.includes('instrumentKey?: string;')) {
    types = types.replace(/confidence: number;/, "confidence: number;\n  instrumentKey?: string;");
}
fs.writeFileSync('src/backend/types.ts', types);

// Fix history in StrategyEngine
if (!code.includes('private history: Map<string, InternalSignal>')) {
    code = code.replace(/private sessionStates:/, 'private history: Map<string, InternalSignal> = new Map();\n  private sessionStates:');
}

// Remove duplicates at the end. The old mapToPublicDecision and createNoTrade are probably at the end of the file.
// We'll just carefully remove the newly appended ones from `fix_end.cjs` and patch the old ones, or just remove the old ones.
// It's safer to remove the OLD ones.
const oldMapRegex = /private mapToPublicDecision\(sig: InternalSignal \| any\): EngineDecision \{[\s\S]*?\}\n\n\s*private createNoTrade\(index: string, spot: number, reason: string\): InternalSignal \{[\s\S]*?\}/m;
code = code.replace(oldMapRegex, '');

// Fix Type 'string' is not assignable to type '"OPENING_TRAP" | ...' in createNoTrade return
code = code.replace(/strategy_family: 'NONE' as any,/g, "strategy_family: 'NONE' as any,");
code = code.replace(/reason: failReason,/g, "reason: [failReason] as any,");
code = code.replace(/reason: \(sig\.reason \|\| \[\]\)\.join\(' \| '\),/g, "reason: [(sig.reason || []).join(' | ')] as any,");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
