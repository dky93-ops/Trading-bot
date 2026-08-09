const fs = require('fs');
let types = fs.readFileSync('src/backend/types.ts', 'utf8');

if (!types.includes('candidateCEWalls')) {
  types = types.replace(/wallTestCounts: Record<number, number>;/, "candidateCEWalls: Record<number, boolean>;\n  candidatePEWalls: Record<number, boolean>;\n  wallTestCounts: Record<number, number>;");
}
fs.writeFileSync('src/backend/types.ts', types);
