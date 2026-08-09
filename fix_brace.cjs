const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
code = code.replace(/return pass\(\);\s*\n\/\/ SETUP VALIDATION/, 'return pass();\n}\n\n// SETUP VALIDATION');
fs.writeFileSync('src/backend/validation-rules.ts', code);
