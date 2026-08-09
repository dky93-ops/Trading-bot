const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const dateHelper = `
  private getISTDateKey(timestamp: any): string {
    return new Date(timestamp).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata'
    });
  }

  private extractSeries`;

engine = engine.replace(/  private extractSeries/, dateHelper);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
