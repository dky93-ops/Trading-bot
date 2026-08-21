const fs = require('fs');

const code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

const target = `  private createSignal(
    index: string,
    spot: number,
    setupType: string,
    direction: 'CALL' | 'PUT',
    brokenLevel: number,
    chainRows: any[],
    sess: LocalSessionState,
    passed: string[],
    failed: string[],
  ): InternalSignal | null {`;

const newCode = code.replace(target, `  private createSignal(
    index: string,
    spot: number,
    setupType: string,
    direction: 'CALL' | 'PUT',
    brokenLevel: number,
    chainRows: any[],
    sess: LocalSessionState,
    passed: string[],
    failed: string[],
    setup: ProposedSetup,
    candles: Candle[]
  ): InternalSignal | null {`);

fs.writeFileSync('src/backend/strategy-engine.ts', newCode);
console.log('patched signature');
