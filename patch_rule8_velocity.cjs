const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

code = code.replace(
  `    let oldOI = null;
    let minDiff = Infinity;
    for (const entry of history) {
      if (entry.time <= min15Ago) {
         oldOI = entry.oi;
      }
    }`,
  `    let oldOI = null;
    let minDiff = Infinity;
    for (const entry of history) {
      const diff = Math.abs(entry.time - min15Ago);
      if (diff < minDiff) {
         minDiff = diff;
         oldOI = entry.oi;
      }
    }`
);

fs.writeFileSync('src/backend/validation-rules.ts', code);
