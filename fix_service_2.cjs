const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf-8');

code = code.replace(/public getOptionChainHistory\(\) {[\s\S]*?public clearOptionChainHistory\(\) {[\s\S]*?}\n/, '');

const constructorCode = `
  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.strategyEngine = new StrategyEngine(
      this.settings, 
      this.state, 
      this.fetchOptionData.bind(this)
    );
    
    if (fs.existsSync(this.historyFilePath)) {
      try {
        const data = fs.readFileSync(this.historyFilePath, 'utf8');
        this.optionChainHistory = JSON.parse(data);
      } catch (e) {
        console.error("Failed to load option chain history:", e);
      }
    }
    
    if (this.hasBrokerCredentials()) {
      this.startPolling();
    }

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'STATE_UPDATE', data: this.state }));
      
      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  private saveOptionChainHistoryToDisk() {
    try {
      const dir = path.dirname(this.historyFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.historyFilePath, JSON.stringify(this.optionChainHistory));
    } catch (e) {
      console.error("Failed to save option chain history:", e);
    }
  }
`;

code = code.replace('public updateSettings', constructorCode + '\n  public updateSettings');
fs.writeFileSync('src/backend/upstox-service.ts', code);
console.log('Fixed constructor and save method');
