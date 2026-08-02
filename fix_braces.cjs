const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Find the second StatBox and remove it.
const statBoxIdx = code.indexOf('function StatBox', code.indexOf('function StatBox') + 1);
if (statBoxIdx !== -1) {
  code = code.substring(0, statBoxIdx);
}

fs.writeFileSync('src/App.tsx', code);
