const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Remove access token input from UI
const inputRegex = /<div className="space-y-2">[\s\S]*?<Label htmlFor="accessToken">Upstox Access Token<\/Label>[\s\S]*?<Input[\s\S]*?id="accessToken"[\s\S]*?value=\{tempSettings\.accessToken[\s\S]*?onChange=\{[\s\S]*?\}[\s\S]*?\/>[\s\S]*?<\/div>/;
code = code.replace(inputRegex, '');

// Don't send token info back on save
const saveRegex = /const saveSettings = async \(\) => \{[\s\S]*?try \{/;
const newSave = `const saveSettings = async () => {
    try {
      const { apiKey, apiSecret, accessToken, ...safeSettings } = tempSettings;
`;
code = code.replace(saveRegex, newSave);
code = code.replace(/body: JSON\.stringify\(tempSettings\)/g, 'body: JSON.stringify(safeSettings)');

fs.writeFileSync('src/App.tsx', code);
