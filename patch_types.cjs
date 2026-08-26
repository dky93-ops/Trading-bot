const fs = require('fs');
let code = fs.readFileSync('src/backend/types.ts', 'utf-8');
if (!code.includes('wallOIHistory')) {
  code = code.replace("wallPeakOI?: Record<number, number>;", "wallPeakOI?: Record<number, number>;\n  wallOIHistory?: Record<number, {time: number, oi: number}[]>;");
  fs.writeFileSync('src/backend/types.ts', code);
}
