const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

const regex = /\/\/ Wall validations\s+if \(setup\.setupType === 'OI_WALL_REJECTION'\) \{[\s\S]*?return pass\(\);\s*\}/g;

code = code.replace(regex, 'return pass();');

fs.writeFileSync('src/backend/validation-rules.ts', code);
