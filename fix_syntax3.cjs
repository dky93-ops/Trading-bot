const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

code = code.replace(
  `  );
}
}`,
  `  );
}`
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed extra bracket');
