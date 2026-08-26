const fs = require('fs');

// 1. Update types.ts
let typesCode = fs.readFileSync('src/backend/types.ts', 'utf-8');
typesCode = typesCode.replace(
  "wallOIHistory?: Record<number, {time: number, oi: number}[]>;",
  "wallOIHistory?: Record<string, {time: number, oi: number}[]>;"
);
fs.writeFileSync('src/backend/types.ts', typesCode);

// 2. Update strategy-engine.ts
let engineCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');
engineCode = engineCode.replace(
  "if (!sess.wallOIHistory[strike]) sess.wallOIHistory[strike] = [];",
  "if (!sess.wallOIHistory[`${strike}_CE`]) sess.wallOIHistory[`${strike}_CE`] = [];"
).replace(
  "sess.wallOIHistory[strike].push({ time: simTime, oi: ceOI });",
  "sess.wallOIHistory[`${strike}_CE`].push({ time: simTime, oi: ceOI });"
);

engineCode = engineCode.replace(
  "if (!sess.wallOIHistory[strike]) sess.wallOIHistory[strike] = [];",
  "if (!sess.wallOIHistory[`${strike}_PE`]) sess.wallOIHistory[`${strike}_PE`] = [];"
).replace(
  "sess.wallOIHistory[strike].push({ time: simTimePE, oi: peOI });",
  "sess.wallOIHistory[`${strike}_PE`].push({ time: simTimePE, oi: peOI });"
);
fs.writeFileSync('src/backend/strategy-engine.ts', engineCode);

// 3. Update validation-rules.ts
let rulesCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');
rulesCode = rulesCode.replace(
  "const history = ctx.sessState.wallOIHistory?.[setup.level];",
  "const history = ctx.sessState.wallOIHistory?.[`${setup.level}_${side}`];"
);
fs.writeFileSync('src/backend/validation-rules.ts', rulesCode);

console.log('Fixed wallOIHistory bug');
