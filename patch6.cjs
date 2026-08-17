const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Find the last closing brace of the class
const lastBraceIndex = code.lastIndexOf('}');

const methodCode = `
  public getTimeWindow(nowMs: number): string {
    const d = new Date(nowMs);
    const h = Number(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }));
    const m = Number(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', minute: 'numeric' }));
    const timeNum = h * 100 + m;

    if (timeNum >= 915 && timeNum < 920) return '09:15-09:20';
    if (timeNum >= 920 && timeNum < 1000) return '09:20-10:00';
    if (timeNum >= 1000 && timeNum < 1230) return '10:00-12:30';
    if (timeNum >= 1230 && timeNum < 1330) return '12:30-13:30';
    if (timeNum >= 1330 && timeNum < 1500) return '13:30-15:00';
    return 'POST-15:00';
  }
`;

code = code.substring(0, lastBraceIndex) + methodCode + '\\n}\n';
fs.writeFileSync('src/backend/strategy-engine.ts', code);
