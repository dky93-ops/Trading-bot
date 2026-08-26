const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-signals-generator.ts', 'utf-8');

// The replacement logic: we want to replace the manual calculation of spot targets with setup variables
code = code.replace(/const riskPoints = Math\.abs\(spot - level\);\s*const rewardPoints = riskPoints \* [0-9\.]+;/g, '');
code = code.replace(/const riskPoints = Math\.abs\(spot - wall\);\s*const rewardPoints = riskPoints \* [0-9\.]+;/g, '');
code = code.replace(/const impulseRange = setup\.firstImpulseRange \|\| 20;/g, '');

code = code.replace(/spotInvalidation: level,/g, 'spotInvalidation: setup.stopLoss || level,');
code = code.replace(/spotInvalidation: wall,/g, 'spotInvalidation: setup.stopLoss || wall,');
code = code.replace(/spotTarget1: direction === 'CALL' \? spot \+ rewardPoints : spot - rewardPoints,/g, 'spotTarget1: setup.target1 || spot,');
code = code.replace(/spotTarget2: direction === 'CALL' \? spot \+ rewardPoints \* 2 : spot - rewardPoints \* 2,/g, 'spotTarget2: setup.target2 || spot,');

fs.writeFileSync('src/backend/strategy-signals-generator.ts', code);
console.log('Done');
