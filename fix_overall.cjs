const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');

code = code.replace(/if \(\!setup\.putPremiumSeriesLast3 \|\| setup\.putPremiumSeriesLast3\.length \< 3\)/,
`const premiumSeriesLast3 = setup.direction === 'CALL' ? setup.callPremiumSeriesLast3 : setup.putPremiumSeriesLast3;
  const oiSeriesLast3 = setup.direction === 'CALL' ? setup.callOiSeriesLast3 : setup.putOiSeriesLast3;
  const oppOiSeriesLast3 = setup.direction === 'CALL' ? setup.oppCallOiSeriesLast3 : setup.oppPutOiSeriesLast3;

  if (!premiumSeriesLast3 || premiumSeriesLast3.length < 3)`);

code = code.replace(/if \(\!setup\.putOiSeriesLast3 \|\| setup\.putOiSeriesLast3\.length \< 3\)/, "if (!oiSeriesLast3 || oiSeriesLast3.length < 3)");
code = code.replace(/if \(\!setup\.oppPutOiSeriesLast3 \|\| setup\.oppPutOiSeriesLast3\.length \< 3\)/, "if (!oppOiSeriesLast3 || oppOiSeriesLast3.length < 3)");

code = code.replace(/const \[p1, p2, p3\] = setup\.putPremiumSeriesLast3;/, "const [p1, p2, p3] = premiumSeriesLast3;");
code = code.replace(/const \[o1, o2, o3\] = setup\.putOiSeriesLast3;/, "const [o1, o2, o3] = oiSeriesLast3;");
code = code.replace(/const \[oo1, oo2, oo3\] = setup\.oppPutOiSeriesLast3;/, "const [oo1, oo2, oo3] = oppOiSeriesLast3;");

fs.writeFileSync('src/backend/validation-rules.ts', code);
