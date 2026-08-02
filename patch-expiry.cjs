const fs = require('fs');
let content = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

const getNearestExpiryFunc = `
  private nearestExpiryCache: Record<string, { date: string, timestamp: number }> = {};

  private async getNearestExpiry(instrumentKey: string): Promise<string> {
    const cached = this.nearestExpiryCache[instrumentKey];
    if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
      return cached.date;
    }
    
    try {
      const response = await axios.get(\`https://api.upstox.com/v2/option/contract?instrument_key=\${instrumentKey}\`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': \`Bearer \${this.settings.accessToken}\`
        }
      });
      
      if (response.data && response.data.data) {
         const expirys = [...new Set(response.data.data.map((c: any) => c.expiry))].sort();
         const today = new Date().toISOString().split('T')[0];
         const validExpirys = expirys.filter((e: any) => e >= today);
         
         if (validExpirys.length > 0) {
            this.nearestExpiryCache[instrumentKey] = { date: validExpirys[0] as string, timestamp: Date.now() };
            return validExpirys[0] as string;
         }
      }
    } catch (e) {
      console.error('Error fetching contracts for expiry:', e);
    }
    
    // Fallback: Compute nearest Thursday for NIFTY, Wednesday for BANKNIFTY
    const todayObj = new Date();
    todayObj.setHours(0,0,0,0);
    const targetDay = instrumentKey.includes('Nifty 50') ? 4 : 3;
    let daysToAdd = (targetDay - todayObj.getDay() + 7) % 7;
    
    const now = new Date();
    if (daysToAdd === 0 && (now.getHours() > 15 || (now.getHours() === 15 && now.getMinutes() >= 30))) {
        daysToAdd = 7;
    }
    const expiryDate = new Date(todayObj.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    return expiryDate.toISOString().split('T')[0];
  }
`;

content = content.replace(
  `private optionChainCache: Record<string, { data: any, timestamp: number }> = {};`,
  `private optionChainCache: Record<string, { data: any, timestamp: number }> = {};\n${getNearestExpiryFunc}`
);

content = content.replace(
  `let expiry = this.settings.expiryDate || 'CURRENT';\n      // Fallback expiry logic could be added here if 'CURRENT' causes issues\n      const chainResponse = await this.getOptionChain(instrumentKey, expiry);`,
  `let expiry = this.settings.expiryDate;\n      if (!expiry || expiry === 'CURRENT') {\n        expiry = await this.getNearestExpiry(instrumentKey);\n      }\n      const chainResponse = await this.getOptionChain(instrumentKey, expiry);`
);

fs.writeFileSync('src/backend/upstox-service.ts', content);
