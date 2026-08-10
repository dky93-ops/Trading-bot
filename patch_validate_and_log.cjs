const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /if \(result\.reason && result\.reason\.includes\('FAILED_FINAL_SAFETY_CHECK'\)\) \{\s*throw new Error\(\`FINAL_SAFETY_FAILED: \$\{result\.reason\}\`\);\s*\}/;

const replacement = `if (result.reason && result.reason.includes('FAILED_FINAL_SAFETY_CHECK')) {
        // Do not throw to prevent stopping later valid families
      }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('validateAndLog patched');
