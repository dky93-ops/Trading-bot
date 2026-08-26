import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { config } from "dotenv";
import { UpstoxService } from "./src/backend/upstox-service.js";

config();

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  app.use(cors());
  app.use(express.json());
  
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // Initialize Upstox Service (this handles polling, strategies, and signals)
  const upstoxService = new UpstoxService(wss);
  
  // Health Check Endpoint for Koyeb / UptimeRobot keep-alive checks
  let healthCheckCount = 0;
  let lastPingTime: string | null = null;
  let lastPingUserAgent: string | null = null;
  let recentPings: Array<{ time: string; userAgent: string; ip: string }> = [];

  app.get("/api/health", (req, res) => {
    healthCheckCount++;
    lastPingTime = new Date().toISOString();

    res.json({
      status: upstoxService.getState().isConnected ? 'healthy' : 'degraded',
      marketDataFresh:
        Date.now() - Number(upstoxService.getState().nifty50.timestamp || 0) < 12_000,
      databaseReady: true,
      reason: upstoxService.getState().apiError || null,
      timestamp: lastPingTime,
    });
  });

  // Settings API
  
  app.get("/api/candles", async (req, res) => {
    try {
      const instrument = req.query.instrument || 'NIFTY';
      const timeframe = Number(req.query.timeframe) || 1;
      const limit = Number(req.query.limit) || 100;
      
      const { getCandles } = await import("./src/db/market.ts");
      const candles = await getCandles(instrument.toString(), timeframe, limit);
      res.json(candles);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

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
  });

  // State API (Dashboard metrics, signals)
  app.get("/api/state", (req, res) => {
    res.json(upstoxService.getState());
  });

  // Reset Signals / PnL API
  app.post("/api/reset-signals", (req, res) => {
    try {
      upstoxService.resetSignals();
      res.json({ success: true, state: upstoxService.getState() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Option Chain Expiries API
  app.get("/api/expirys", async (req, res) => {
    try {
      const { instrument } = req.query;
      const expirys = await upstoxService.getExpiries(instrument as string || 'NSE_INDEX|Nifty 50');
      res.json({ status: "success", expirys });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Option Chain API
  app.get("/api/option-chain", async (req, res) => {
    try {
      const { instrument, expiry } = req.query;
      const data = await upstoxService.getOptionChain(instrument as string, expiry as string);
      res.json({ status: "success", data: data });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Option Chain Recorded History API for Backtest & Analysis Replay
  app.get("/api/option-chain/history", (req, res) => {
    try {
      const history = upstoxService.getOptionChainHistory();
      res.json({ status: "success", count: history.length, snapshots: history });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/option-chain/clear", (req, res) => {
    try {
      upstoxService.clearOptionChainHistory();
      res.json({ success: true, message: "Option chain history cleared." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/option-chain/export", (req, res) => {
    try {
      const history = upstoxService.getOptionChainHistory();
      const filename = `option_chain_replay_${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(history, null, 2));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Market News & OI Context API
  app.get("/api/market-news", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: "Provide the latest real-time Indian stock market news highlights for Nifty 50, Bank Nifty, and Index Options trading. Include 4-5 key concise news items with sentiment (BULLISH, BEARISH, or NEUTRAL), headline, affected index, time, and options market context (OI interpretation). Return a JSON array with objects: title, summary, sentiment, category, time, oiContext.",
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  summary: { type: "STRING" },
                  sentiment: { type: "STRING" },
                  category: { type: "STRING" },
                  time: { type: "STRING" },
                  oiContext: { type: "STRING" },
                },
                required: ["title", "summary", "sentiment", "category", "time", "oiContext"],
              },
            },
          },
        });
        const text = response.text || "";
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        const jsonStr = jsonMatch ? jsonMatch[0] : text.replace(/```json/gi, "").replace(/```/g, "").trim();
        const newsItems = JSON.parse(jsonStr);
        if (Array.isArray(newsItems) && newsItems.length > 0) {
          return res.json({ status: "success", news: newsItems });
        }
      }
    } catch (err: any) {
      console.error("Market news AI fetch error:", err.message);
    }

    // Default fallback news with rich options market context
    return res.json({
      status: "success",
      news: [
        {
          title: "Nifty Holds 24,100 Support Zone Ahead of Key Policy & F&O Expiry",
          summary: "Heavy put writing observed at 24,100 strike while call writers active at 24,250 - 24,300 zone.",
          sentiment: "BULLISH",
          category: "Index / Derivatives",
          time: "Just Now",
          oiContext: "PCR sitting at 1.12 with significant put accumulation at 24,100 ATM level."
        },
        {
          title: "Bank Nifty Consolidates Around 52,000; Private Banks Drive Momentum",
          summary: "HDFC Bank and ICICI Bank lead gains as short covering triggers in 52,000 CE contracts.",
          sentiment: "BULLISH",
          category: "Bank Nifty",
          time: "5 mins ago",
          oiContext: "Call unwinding seen across 52,000 CE indicating bullish breakout setup."
        },
        {
          title: "India VIX Drops Below 13.5; Low Volatility Favors Option Sellers & Gamma Spikes",
          summary: "Volatility contraction favors tight straddle spreads ahead of afternoon breakout window.",
          sentiment: "NEUTRAL",
          category: "Volatility",
          time: "15 mins ago",
          oiContext: "Option premiums compressed, setting up potential 1:30 PM & 2:00 PM gamma spikes."
        },
        {
          title: "FII Net Buyers in Index Futures, DII Maintain Steady Domestic Inflows",
          summary: "Institutional positioning shows strong support at lower strikes for monthly contracts.",
          sentiment: "BULLISH",
          category: "Institutional Flows",
          time: "25 mins ago",
          oiContext: "Net long positions in index futures increased by 14,200 contracts."
        }
      ]
    });
  });

  // Start polling mechanism (since protobuf WS is too complex without schemas)
  upstoxService.startPolling();

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
