const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Fix failedFilters
code = code.replace("const passedFilters: string[] = [];", "");
code = code.replace("const failedFilters: string[] = [];", "");

const target = "let chainRows: any[] = [];";
const replacement = `let chainRows: any[] = [];
    const passedFilters: string[] = [];
    const failedFilters: string[] = [];`;
code = code.replace(target, replacement);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
