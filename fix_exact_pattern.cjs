const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

code = code.replace(
  /if \(!sess\.wallTestCandleKeys\[strike\]\) sess\.wallTestCandleKeys\[strike\] = \[\];\s*if \(!sess\.wallReactionCandleKeys\[strike\]\) sess\.wallReactionCandleKeys\[strike\] = \[\];/g,
  "if (!sess.wallReactionCandleKeys[strike]) sess.wallReactionCandleKeys[strike] = [];"
);

code = code.replace(
  /if \(!sess\.wallTestCandleKeys\[strike\]\.includes\(candleKey\)\) \{\s*sess\.wallTestCandleKeys\[strike\]\.push\(candleKey\);\s*sess\.wallTestCounts\[strike\] = sess\.wallTestCandleKeys\[strike\]\.length;\s*\}/g,
  `if (!sess.wallTestCandleKeys[strike]) {
            sess.wallTestCandleKeys[strike] = [];
          }

          if (!sess.wallTestCandleKeys[strike].includes(candleKey)) {
            sess.wallTestCandleKeys[strike].push(candleKey);
            sess.wallTestCounts[strike] = sess.wallTestCandleKeys[strike].length;
          }`
);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
