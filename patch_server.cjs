const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');
code = code.replace(/res\.json\(data\);/g, 'res.json({ status: "success", data: data });');
fs.writeFileSync('server.ts', code);
console.log("Patched server.ts");
