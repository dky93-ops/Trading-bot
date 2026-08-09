const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

engine = engine.replace(
  /sessionDateIST: new Date\(\)\.toLocaleDateString\('en-US', \{ timeZone: 'Asia\/Kolkata' \}\)/g,
  "sessionDateIST: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })"
);

engine = engine.replace(
  /const currentDateIST = timeObj.toLocaleDateString\('en-US', \{ timeZone: 'Asia\/Kolkata' \}\);/g,
  "const currentDateIST = this.getISTDateKey(timeObj);"
);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
