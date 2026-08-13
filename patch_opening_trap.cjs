const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const c0TimeMs = c0Date\.getTime\(\);[\s\S]*?const windowEnd = c0Date\.setHours\(10, 30, 0, 0\);/m;

const replacement = `const c0TimeMs = c0Date.getTime();
    
    const d = new Date(c0Date);
    const windowStartMs = d.setHours(9, 15, 0, 0);
    const windowEndMs = d.setHours(10, 15, 0, 0);
    
    if (c0TimeMs < windowStartMs || c0TimeMs > windowEndMs) {
      return null;
    }
    
    const isStrongWindow = c0TimeMs <= d.setHours(9, 45, 0, 0);`;

code = code.replace(regex, replacement);

code = code.replace(/setup\.earlyWindow = true;/g, "setup.earlyWindow = true; setup.earlyStrongWindow = isStrongWindow;");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 4 opening trap window complete');
