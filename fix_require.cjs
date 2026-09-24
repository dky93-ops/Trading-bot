const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  /app\.get\("\/api\/option-chain\/export-excel",\s*\(req, res\)\s*=>\s*\{/g,
  'app.get("/api/option-chain/export-excel", async (req, res) => {'
);
code = code.replace(
  /const xlsx = require\("xlsx"\);/g,
  'const xlsx = await import("xlsx");'
);

fs.writeFileSync('server.ts', code);
console.log("Fixed require in server.ts");
