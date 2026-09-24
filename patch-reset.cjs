const fs = require('fs');
let content = fs.readFileSync('src/backend/enhanced-option-chain-recorder.ts', 'utf8');

const resetLogic = `
      // Check for weekly expiry reset (clear history 24 hours after the expiry day ends)
      if (this.history.length > 0) {
        const lastExpiryStr = this.history[0].expiryDate;
        const expiryDateObj = new Date(lastExpiryStr + "T15:30:00+05:30");
        if (!isNaN(expiryDateObj.getTime())) {
          const resetTime = expiryDateObj.getTime() + (24 * 60 * 60 * 1000);
          if (timestamp > resetTime && expiryDate !== lastExpiryStr) {
            console.log(\`Clearing history: 24 hours past expiry \${lastExpiryStr}\`);
            this.clearHistory();
          }
        }
      }

      if (!Array.isArray(rawRows) || rawRows.length === 0) {
`;

if (!content.includes('24 hours after the expiry day ends')) {
  content = content.replace(
    /if \(\!Array\.isArray\(rawRows\) \|\| rawRows\.length === 0\) \{/,
    resetLogic
  );
  fs.writeFileSync('src/backend/enhanced-option-chain-recorder.ts', content);
  console.log("Reset logic added");
}
