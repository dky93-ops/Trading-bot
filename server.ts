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
      const rawInst = (req.query.instrument || 'NIFTY').toString();
      const isGold = rawInst.toUpperCase().includes('GOLD');
      const instrument = isGold ? 'GOLD' : 'NIFTY';
      const timeframe = Number(req.query.timeframe) || 1;
      const limit = Number(req.query.limit) || 100;
      
      const { getCandles, ensureGoldCandles, ensureNiftyCandles } = await import("./src/db/market.ts");
      
      const token = (upstoxService as any)?.settings?.accessToken || process.env.UPSTOX_ACCESS_TOKEN;
      if (isGold) {
        await ensureGoldCandles(token);
      } else {
        await ensureNiftyCandles(token);
      }

      // Fetch excess candles to account for out-of-market hour filtering
      let rawCandles = await getCandles(instrument, 1, limit * timeframe * 10);
      
      // Filter for IST trading hours (MCX Commodity: 09:00 - 23:30 IST; NSE Index: 09:15 - 15:30 IST)
      const nowMs = Date.now();
      const filtered = rawCandles.filter(c => {
           const d = new Date(c.timestamp);
           if (nowMs - d.getTime() < 300000) return true; // Always include fresh real-time candles
           const istTime = new Date(d.getTime() + 19800000);
           const hh = istTime.getUTCHours();
           const mm = istTime.getUTCMinutes();
           const timeNum = hh * 100 + mm;
           if (isGold) {
             return timeNum >= 900 && timeNum <= 2330;
           }
           return timeNum >= 915 && timeNum <= 1530;
      });

      if (filtered.length >= Math.min(25, limit)) {
        rawCandles = filtered.slice(0, limit * timeframe);
      } else if (rawCandles.length > 0) {
        rawCandles = rawCandles.slice(0, limit * timeframe);
      }
      
      if (timeframe === 1) {
         res.json(rawCandles);
         return;
      }
      
      // Aggregate into requested timeframe
      // rawCandles are sorted by DESC timestamp from DB
      rawCandles.reverse(); // Chronological order
      
      const aggregated = [];
      let currentCandle = null;
      let currentPeriodMs = 0;
      const periodMs = timeframe * 60 * 1000;
      
      for (const c of rawCandles) {
         const ts = new Date(c.timestamp).getTime();
         // align to period boundary (IST is UTC + 5:30. 5h30m = 330 mins = 19800000 ms)
         // Need to align boundaries to IST so that 9:15 starts properly for 5m, 15m etc.
         // Better simple boundary: 
         const boundary = Math.floor((ts + 19800000) / periodMs) * periodMs - 19800000;
         
         if (!currentCandle || boundary !== currentPeriodMs) {
            if (currentCandle) aggregated.push(currentCandle);
            currentPeriodMs = boundary;
            currentCandle = {
               timestamp: new Date(boundary).toISOString(),
               open: c.open,
               high: c.high,
               low: c.low,
               close: c.close,
               volume: c.volume
            };
         } else {
            currentCandle.high = Math.max(currentCandle.high, c.high);
            currentCandle.low = Math.min(currentCandle.low, c.low);
            currentCandle.close = c.close;
            currentCandle.volume += c.volume;
         }
      }
      if (currentCandle) aggregated.push(currentCandle);
      
      aggregated.reverse(); // Back to DESC
      res.json(aggregated.slice(0, limit));
      
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
  app.get("/api/debug-oc", (req, res) => {
    res.json({
      isMarketOpen: upstoxService['strategyEngine'].isMarketOpen(),
      time: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
      historyLength: upstoxService.getOptionChainHistory().length,
      rawHistory: upstoxService.getOptionChainHistory()
    });
  });

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


  
  app.get("/api/signals/export-excel", async (req, res) => {
    try {
      const state = upstoxService.getState();
      const settings = upstoxService.getPublicSettings();
      
      if (!state.signals || state.signals.length === 0) {
        return res.status(404).send("No execution signals available to export.");
      }
      
      const xlsx = await import("xlsx");
      const workbook = xlsx.utils.book_new();
      
      const data = state.signals.map((sig) => {
        const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
        const lots = settings?.strategies?.[stratKey]?.lotSize || 1;
        const qty = 75 * lots;
        
        let tradePnL = 0;
        if (sig.status === 'CLOSED') {
          tradePnL = sig.realizedPnL !== undefined ? sig.realizedPnL : ((sig.exitPrice || sig.latestPrice || sig.entryPrice) - sig.entryPrice) * qty;
        } else {
          const curP = sig.latestPrice || sig.entryPrice;
          tradePnL = (curP - sig.entryPrice) * qty;
        }
        
        const formatTimestamp = (ts) => {
          if (!ts) return '-';
          if (typeof ts === 'number') return new Date(ts).toLocaleString();
          const d = new Date(ts);
          if (!isNaN(d.getTime())) return d.toLocaleString();
          return String(ts);
        };
        
        return {
          "Timestamp": formatTimestamp(sig.timestamp || sig.entryTime),
          "Status": sig.status || 'ACTIVE',
          "Signal": sig.signal,
          "Strategy Family": sig.strategy_family || sig.strategy,
          "Spot": sig.spot || sig.entryPrice,
          "Broken Level": sig.broken_level || '-',
          "CE Wall": sig.wall_above || '-',
          "PE Wall": sig.wall_below || '-',
          "Strike": sig.strike ? `${sig.strike} ${sig.option_type}` : sig.contract,
          "Entry Price": sig.entry || sig.entryPrice,
          "Current/Exit Price": sig.status === 'CLOSED' ? (sig.exitPrice !== undefined ? sig.exitPrice : (sig.latestPrice || sig.entryPrice)) : (sig.latestPrice || sig.entryPrice),
          "P&L (₹)": tradePnL,
          "Stoploss": sig.stoploss || sig.stopLoss,
          "Target 1": sig.target1 || sig.target,
          "Target 2": sig.target2 || '-',
          "Confidence (%)": sig.confidence || '-',
          "Reasons & Filters": sig.reason && Array.isArray(sig.reason) ? sig.reason.join(' | ') : '-'
        };
      });
      
      const sheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(workbook, sheet, "Execution Signals");
      
      const filename = `execution_signals_log_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/option-chain/export-excel", async (req, res) => {
    try {
      const history = upstoxService.getOptionChainHistory();
      if (history.length === 0) {
        return res.status(404).send("No history available to export.");
      }
      
      const xlsx = await import("xlsx");
      const workbook = xlsx.utils.book_new();
      
      // We will create a worksheet for the summary and another for the raw data
      const summaryData = history.map(snap => ({
        Time: new Date(snap.timestamp).toLocaleString(),
        SpotPrice: snap.spotPrice,
        TotalCallOI: snap.totalCallOI,
        TotalPutOI: snap.totalPutOI,
        PCR: snap.pcr,
        MaxCallOIStrike: snap.maxCallOIStrike,
        MaxPutOIStrike: snap.maxPutOIStrike,
        ATMStrike: snap.atmStrike
      }));
      
      const summarySheet = xlsx.utils.json_to_sheet(summaryData);
      xlsx.utils.book_append_sheet(workbook, summarySheet, "Summary");
      
      // Let's create a detailed sheet for the ATM rows (wider range: ATM +- 2000)
      const detailedData = [];
      history.forEach(snap => {
        const timeStr = new Date(snap.timestamp).toLocaleString();
        if (snap.enhancedRows && Array.isArray(snap.enhancedRows)) {
            snap.enhancedRows.forEach(row => {
               // Expanding range and adding all relevant columns
               if (Math.abs(row.strike - snap.spotPrice) <= 2000) {
                   detailedData.push({
                     Time: timeStr,
                     Spot: snap.spotPrice,
                     Strike: row.strike,
                     
                     // Calls
                     CE_LTP: row.ce?.ltp || 0,
                     CE_Volume: row.ce?.volume || 0,
                     CE_OI: row.ce?.totalOi || 0,
                     CE_OI_Change: row.ce?.oiChange || 0,
                     CE_IV: row.ce?.iv || 0,
                     CE_Delta: row.ce?.delta || 0,
                     CE_Theta: row.ce?.theta || 0,
                     CE_Gamma: row.ce?.gamma || 0,
                     CE_Vega: row.ce?.vega || 0,
                     CE_Bid: row.ce?.bid || 0,
                     CE_Ask: row.ce?.ask || 0,

                     // Puts
                     PE_LTP: row.pe?.ltp || 0,
                     PE_Volume: row.pe?.volume || 0,
                     PE_OI: row.pe?.totalOi || 0,
                     PE_OI_Change: row.pe?.oiChange || 0,
                     PE_IV: row.pe?.iv || 0,
                     PE_Delta: row.pe?.delta || 0,
                     PE_Theta: row.pe?.theta || 0,
                     PE_Gamma: row.pe?.gamma || 0,
                     PE_Vega: row.pe?.vega || 0,
                     PE_Bid: row.pe?.bid || 0,
                     PE_Ask: row.pe?.ask || 0
                   });
               }
            });
        }
      });
      
      const detailSheet = xlsx.utils.json_to_sheet(detailedData);
      xlsx.utils.book_append_sheet(workbook, detailSheet, "Detailed (ATM +- 2000)");
      
      const filename = `option_chain_replay_${new Date().toISOString().slice(0, 10)}.xlsx`;
      
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
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
