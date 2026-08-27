const fs = require('fs');
const file = 'src/backend/strategy-signals-generator.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/const optionStoploss = optionEntry \* 0\.65;/g, "const optionStoploss = (optionData as any).structuralOptionStop || (optionEntry * 0.65);");
content = content.replace(/const optionStoploss = optionEntry \* 0\.65;/g, "const optionStoploss = (optionData as any).structuralOptionStop || (optionEntry * 0.65);");
content = content.replace(/const optionStoploss = optionEntry \* 0\.65;/g, "const optionStoploss = (optionData as any).structuralOptionStop || (optionEntry * 0.65);");
content = content.replace(/const optionStoploss = optionEntry \* 0\.65;/g, "const optionStoploss = (optionData as any).structuralOptionStop || (optionEntry * 0.65);");

fs.writeFileSync(file, content);
console.log('Fixed strategy-signals-generator.ts');
