const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const badT2 = `    // STRICT R:R GUARDRAIL: Minimum 1.5R required for Target 2
    if (rrTarget2 < 1.5) {
      failedFilters.push(\`Reward-to-risk to Target 2 (\${rrTarget2.toFixed(2)}R) is less than strict 1.50R minimum required\`);
      return null;
    }

    let finalConfidence = initialConfidence;
    passedFilters.push(\`Reward-to-risk to Target 2 is \${rrTarget2.toFixed(2)}R (>= 1.5R threshold passed)\`);`;

const fixT2 = `    let finalConfidence = initialConfidence;
    if (rrTarget2 < 1.5) {
      failedFilters.push(\`Reward-to-risk to Target 2 (\${rrTarget2.toFixed(2)}R) is < 1.5R (confidence reduced)\`);
      finalConfidence = Math.max(10, finalConfidence - 20);
    } else {
      passedFilters.push(\`Reward-to-risk to Target 2 is \${rrTarget2.toFixed(2)}R (>= 1.5R threshold passed)\`);
    }`;

code = code.replace(badT2, fixT2);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
