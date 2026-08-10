const fs = require('fs');
let code = fs.readFileSync('src/backend/types.ts', 'utf8');

if (!code.includes('WALL_TOLERANCE_POINTS')) {
  code = code.replace(/expiryDate: string;/, "expiryDate: string;\n  WALL_TOLERANCE_POINTS?: number;\n  OPENING_RANGE_MINUTES?: number;");
}

if (!code.includes('openingRangeComplete')) {
  code = code.replace(/openingRangeLow: number;/, "openingRangeLow: number;\n  openingRangeComplete: boolean;");
}

fs.writeFileSync('src/backend/types.ts', code);
