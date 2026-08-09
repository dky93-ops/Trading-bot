const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
code = code.replace(/return \{ passed: true, reason: 'Passed' \};\s*\}$/, 'return pass();\n}');
fs.writeFileSync('src/backend/validation-rules.ts', code);
