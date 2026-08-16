const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!pkg.scripts['strategy:compliance']) {
  pkg.scripts['strategy:compliance'] = 'tsx scripts/check-strategy-compliance.ts';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
}
