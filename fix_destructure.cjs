const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

code = code.replace(/const \{ premiumSeriesLast3, oppPremiumSeriesLast3 \} = setup;/g, 
`const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  const oppPremiumSeriesLast3 = setup.direction === 'CALL' ? setup.putPremiumSeriesLast3 : setup.callPremiumSeriesLast3;`);

code = code.replace(/const \{ spotMoveFromLevel, premiumSeriesLast3 \} = setup;/g, 
`const spotMoveFromLevel = setup.spotMoveFromLevel;
  const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;`);

fs.writeFileSync('src/backend/validation-rules.ts', code);
