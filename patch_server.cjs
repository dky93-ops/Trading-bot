const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const oldSettingsRoute = `  // Settings API
  app.get("/api/settings", (req, res) => {
    res.json(upstoxService.getSettings());
  });

  app.post("/api/settings", (req, res) => {
    try {
      const newSettings = req.body;
      upstoxService.updateSettings(newSettings);
      res.json({ success: true, settings: upstoxService.getSettings() });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });`;

const newSettingsRoute = `  // Settings API
  app.get('/api/settings', (_req, res) => {
    res.json(upstoxService.getPublicSettings());
  });

  app.post('/api/settings', (req, res) => {
    try {
      const body = { ...req.body };
      delete body.apiKey;
      delete body.apiSecret;
      delete body.accessToken;
      
      upstoxService.updateSettings(body);
      res.json({ success: true, settings: upstoxService.getPublicSettings() });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });`;
  
code = code.replace(oldSettingsRoute, newSettingsRoute);

const oldHealthCheck = `  app.get("/api/health", (req, res) => {
    healthCheckCount++;
    lastPingTime = new Date().toISOString();
    lastPingUserAgent = req.headers['user-agent'] || 'unknown';
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    
    recentPings.unshift({
      time: lastPingTime,
      userAgent: lastPingUserAgent,
      ip: clientIp
    });
    if (recentPings.length > 10) recentPings.pop();

    res.json({
      status: "healthy",
      timestamp: lastPingTime,
      pingCount: healthCheckCount,
      lastPingUserAgent,
      recentPings
    });
  });`;
  
const newHealthCheck = `  app.get("/api/health", (req, res) => {
    healthCheckCount++;
    lastPingTime = new Date().toISOString();

    res.json({
      status: upstoxService.getPublicSettings().paperTradingOnly
        ? (upstoxService.getState().isConnected ? 'healthy' : 'degraded')
        : 'blocked',
      paperTradingOnly: upstoxService.getPublicSettings().paperTradingOnly,
      marketDataFresh:
        Date.now() - Number(upstoxService.getState().nifty50.timestamp || 0) < 12_000,
      databaseReady: true,
      reason: upstoxService.getState().apiError || null,
      timestamp: lastPingTime,
    });
  });`;

code = code.replace(oldHealthCheck, newHealthCheck);

fs.writeFileSync('server.ts', code);
console.log('Patched server.ts');
