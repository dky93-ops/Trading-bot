const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// The issue is around line 391.
// Let's just find `</button>\n        ))}\n` and add `</div>` after it.

if (!code.includes('</button>\n        ))}\n        </div>')) {
  code = code.replace('</button>\n        ))}\n', '</button>\n        ))}\n        </div>\n');
  fs.writeFileSync('src/components/LiveChart.tsx', code);
  console.log('Added missing closing div');
} else {
  console.log('Closing div already exists?');
}

