const fs = require('fs');

let types = fs.readFileSync('src/backend/types.ts', 'utf8');
if (!types.includes('oiChange?: number')) {
  types = types.replace(/type: 'CE' \| 'PE';/g, "type: 'CE' | 'PE';\n  oiChange?: number;");
}
if (!types.includes('wallLastProcessedSnapshotKey')) {
  types = types.replace(/wallLastSeenOI: Record<number, number>;/g, "wallLastSeenOI: Record<number, number>;\n  wallLastProcessedSnapshotKey: Record<number, string>;");
}
fs.writeFileSync('src/backend/types.ts', types);

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');
let idx = engine.indexOf("const tests = sess.wallTestCounts[wallAbove] || 0;");
if (idx !== -1 && !engine.includes("const c0Index = candles.length - 1;", Math.max(0, idx - 100))) {
  engine = engine.substring(0, idx) + "const c0Index = candles.length - 1;\n          " + engine.substring(idx);
}

let idx2 = engine.indexOf("const tests = sess.wallTestCounts[wallBelow] || 0;");
if (idx2 !== -1 && !engine.includes("const c0Index = candles.length - 1;", Math.max(0, idx2 - 100))) {
  engine = engine.substring(0, idx2) + "const c0Index = candles.length - 1;\n          " + engine.substring(idx2);
}

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
