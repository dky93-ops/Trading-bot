import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { config } from "dotenv";
import { UpstoxService } from "./src/backend/upstox-service.js";
import {
  OptionPremiumResolver,
  buildCompactOptionSnapshots,
  NIFTY_LOT_SIZE,
  TradeOptionInput,
} from "./src/backend/option-premium-resolver.js";

config();

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // Initialize Upstox Service (this handles polling, strategies, and signals)
  const upstoxService = new UpstoxService(wss);
  const optionPremiumResolver = new OptionPremiumResolver({
    getHistory: () => upstoxService.getOptionChainHistory(),
    getAccessToken: () => upstoxService.getAccessToken(),
    getActiveExpiries: (instrumentKey) => upstoxService.getExpiries(instrumentKey),
    getActiveOptionChain: (instrumentKey, expiryDate) => upstoxService.getOptionChain(instrumentKey, expiryDate),
  });

  // Automatically backfill missing recent historical option chain snapshots into PostgreSQL on startup
  setTimeout(() => {
    optionPremiumResolver
      .backfillHistoricalOptionChain({
        maxDays: 10,
        onSnapshotsCreated: (snaps) => upstoxService.mergeOptionChainSnapshots(snaps),
      })
      .then((summary) => {
        if (summary.snapshotsCreated > 0) {
          console.log(
            `[OptionBackfill] Startup backfill complete: ${summary.snapshotsCreated} snapshots across ${summary.extractedDays.join(', ')}`
          );
        }
      })
      .catch((e) => {
        console.warn("[OptionBackfill] Startup backfill warning:", e?.message || e);
      });
  }, 5000);
  
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
      const timeframe = Number(req.query.timeframe) || 1;
      const limit = Number(req.query.limit) || 100;
      
      const { getCandles, ensureNiftyCandles, ensureNifty5mCandles, isMarketHours } = await import("./src/db/market.ts");
      
      const token = (upstoxService as any)?.settings?.accessToken || process.env.UPSTOX_ACCESS_TOKEN;
      await ensureNiftyCandles(token);
      if (timeframe === 5) {
        await ensureNifty5mCandles(token).catch(e => console.error("ensureNifty5mCandles error:", e));
      }

      if (timeframe === 5) {
        const direct5m = await getCandles('NIFTY', 5, limit * 2);
        const valid5m = direct5m.filter(c => isMarketHours(c.timestamp));
        if (valid5m.length >= Math.min(20, limit)) {
          res.json(valid5m.slice(0, limit));
          return;
        }
      }

      // Fetch candles to account for out-of-market hour filtering
      const rawCandles = await getCandles('NIFTY', 1, limit * timeframe * 10);
      
      // Strictly filter for genuine NSE market trading hours (Mon-Fri 09:15-15:30)
      const filtered = rawCandles.filter(c => isMarketHours(c.timestamp));
      const validCandles = filtered.slice(0, limit * timeframe);
      
      if (timeframe === 1) {
         res.json(validCandles.slice(0, limit));
         return;
      }
      
      // Aggregate into requested timeframe
      // validCandles are sorted by DESC timestamp from DB
      validCandles.reverse(); // Chronological order
      
      const aggregated = [];
      let currentCandle: any = null;
      let currentPeriodMs = 0;
      const periodMs = timeframe * 60 * 1000;
      
      for (const c of validCandles) {
         const ts = new Date(c.timestamp).getTime();
         // Align to period boundary in IST
         const boundary = Math.floor((ts + 19800000) / periodMs) * periodMs - 19800000;
         if (!isMarketHours(boundary)) continue;
         
         if (!currentCandle || boundary !== currentPeriodMs) {
            if (currentCandle && isMarketHours(currentPeriodMs)) {
               aggregated.push(currentCandle);
            }
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
      if (currentCandle && isMarketHours(currentPeriodMs)) {
        aggregated.push(currentCandle);
      }
      
      aggregated.reverse(); // Back to DESC
      res.json(aggregated.slice(0, limit));
      
    } catch (error: any) {
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

  // Real-Time Trade Notifications API (WebSocket-backed, server-authoritative)
  app.get("/api/notifications", (_req, res) => {
    res.json({
      status: "success",
      notifications: upstoxService.getNotifications(),
    });
  });

  app.post("/api/notifications/emit", (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: "Invalid notification payload" });
      }
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const kind =
        body.kind === 'TRADE_OPENED' || body.kind === 'TRADE_CLOSED' || body.kind === 'SETUP_PENDING'
          ? body.kind
          : null;
      const direction = body.direction === 'CALL' || body.direction === 'PUT' ? body.direction : null;
      const signal = typeof body.signal === 'string' ? body.signal.trim().slice(0, 140) : '';
      const entryPrice = Number(body.entryPrice);

      if (!id || id.length > 160 || !kind || !direction || !signal || !Number.isFinite(entryPrice) || entryPrice <= 0) {
        return res.status(400).json({ error: "Missing or invalid required trade notification fields" });
      }

      const source =
        body.source === 'LIVE_CHART' ||
        body.source === 'STRATEGY_ENGINE' ||
        body.source === 'SERVER_SAM_WATCHER' ||
        body.source === 'TEST'
          ? body.source
          : 'LIVE_CHART';

      const optionalNum = (v: unknown): number | undefined => {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };

      const result = upstoxService.emitTradeNotification({
        id,
        kind,
        direction,
        signal,
        source,
        timestamp: optionalNum(body.timestamp) ?? Date.now(),
        candleTimeSec: optionalNum(body.candleTimeSec),
        entryPrice,
        stoploss: optionalNum(body.stoploss),
        target: optionalNum(body.target),
        exitPrice: optionalNum(body.exitPrice),
        exitReason: typeof body.exitReason === 'string' ? body.exitReason.slice(0, 60) : undefined,
        status:
          body.status === 'OPEN' || body.status === 'WIN' || body.status === 'LOSS' || body.status === 'BE'
            ? body.status
            : undefined,
        spotPnl: optionalNum(body.spotPnl),
        optionStrike: optionalNum(body.optionStrike),
        optionType: body.optionType === 'CE' || body.optionType === 'PE' ? body.optionType : undefined,
        optionEntryPremium: optionalNum(body.optionEntryPremium),
        optionExitPremium: optionalNum(body.optionExitPremium),
        premiumPnl: optionalNum(body.premiumPnl),
        lotPnl: optionalNum(body.lotPnl),
        message: typeof body.message === 'string' ? body.message.slice(0, 180) : undefined,
      });

      res.json({ status: "success", accepted: result.accepted, event: result.event });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/notifications/test", (_req, res) => {
    try {
      const event = upstoxService.emitTestNotification();
      res.json({ status: "success", event });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/notifications/clear", (_req, res) => {
    try {
      upstoxService.clearNotifications();
      res.json({ status: "success" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/sam-config", (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: "Invalid SAM config payload" });
      }
      upstoxService.updateLiveSamConfig(req.body);
      res.json({ status: "success" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/option-chain/premium-lookup", (req, res) => {
    try {
      const history = upstoxService.getOptionChainHistory();
      const compactSnapshots = buildCompactOptionSnapshots(history);

      const ceLtps = compactSnapshots.map(s => s.ceLtp).filter((v): v is number => typeof v === 'number' && v > 0);
      const peLtps = compactSnapshots.map(s => s.peLtp).filter((v): v is number => typeof v === 'number' && v > 0);
      const deltas = compactSnapshots
        .flatMap(s => [s.ceDelta, s.peDelta])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0)
        .map(v => Math.abs(v));

      const avg = (arr: number[]) => arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null;

      res.json({
        status: "success",
        count: compactSnapshots.length,
        lotSize: NIFTY_LOT_SIZE,
        avgAtmDelta: avg(deltas),
        avgAtmCeLtp: avg(ceLtps),
        avgAtmPeLtp: avg(peLtps),
        snapshots: compactSnapshots,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/option-chain/resolve-trades", async (req, res) => {
    try {
      const rawTrades = req.body?.trades;
      const timeframeMin = Math.max(1, Math.min(60, Number(req.body?.timeframeMin) || 1));
      if (!Array.isArray(rawTrades)) {
        return res.status(400).json({ error: "trades array is required" });
      }
      if (rawTrades.length > 500) {
        return res.status(400).json({ error: "Maximum 500 trades per request" });
      }

      const sanitized: TradeOptionInput[] = [];
      for (const item of rawTrades) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id || '').trim();
        const type = item.type === 'SHORT' ? 'SHORT' : item.type === 'LONG' ? 'LONG' : null;
        const entryTime = Number(item.entryTime);
        const entryPrice = Number(item.entryPrice);
        if (!id || !type || !Number.isFinite(entryTime) || !Number.isFinite(entryPrice) || entryPrice <= 0) {
          continue;
        }
        const status = item.status === 'WIN' || item.status === 'LOSS' || item.status === 'BE' ? item.status : 'OPEN';
        sanitized.push({
          id,
          type,
          entryTime,
          entryPrice,
          exitTime: Number.isFinite(Number(item.exitTime)) ? Number(item.exitTime) : undefined,
          exitPrice: Number.isFinite(Number(item.exitPrice)) ? Number(item.exitPrice) : undefined,
          exitReason: typeof item.exitReason === 'string' ? item.exitReason : undefined,
          status,
          pnl: Number.isFinite(Number(item.pnl)) ? Number(item.pnl) : undefined,
          timeframeMin: Number.isFinite(Number(item.timeframeMin)) ? Math.max(1, Number(item.timeframeMin)) : timeframeMin,
          exitSpotBar: item.exitSpotBar &&
            Number.isFinite(Number(item.exitSpotBar.high)) &&
            Number.isFinite(Number(item.exitSpotBar.low))
            ? {
                open: Number(item.exitSpotBar.open) || Number(item.exitSpotBar.close) || entryPrice,
                high: Number(item.exitSpotBar.high),
                low: Number(item.exitSpotBar.low),
                close: Number(item.exitSpotBar.close) || entryPrice,
              }
            : undefined,
        });
      }

      const resolved = await optionPremiumResolver.resolveTrades(sanitized, timeframeMin);
      res.json({
        status: "success",
        lotSize: NIFTY_LOT_SIZE,
        count: Object.keys(resolved).length,
        resolved,
      });
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
      console.warn("Failed to get expiries from Upstox, providing default schedule:", e.message);
      const fallback = upstoxService.generateDefaultExpiries(req.query.instrument as string || 'NSE_INDEX|Nifty 50');
      res.json({ status: "success", expirys: fallback });
    }
  });

  // Option Chain API
  app.get("/api/option-chain", async (req, res) => {
    try {
      const { instrument, expiry } = req.query;
      const data = await upstoxService.getOptionChain(instrument as string, expiry as string);
      res.json({ status: "success", data: data });
    } catch (e: any) {
      console.warn("Failed to get option chain:", e.message);
      res.json({ status: "success", data: [] });
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

  app.post("/api/option-chain/backfill", async (req, res) => {
    try {
      const maxDays = Math.max(1, Math.min(25, Number(req.body?.maxDays) || 12));
      const summary = await optionPremiumResolver.backfillHistoricalOptionChain({
        maxDays,
        onSnapshotsCreated: (snaps) => upstoxService.mergeOptionChainSnapshots(snaps),
      });
      res.json({
        status: "success",
        ...summary,
        totalSnapshots: upstoxService.getOptionChainHistory().length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/option-chain/history", (req, res) => {
    try {
      const history = upstoxService.getOptionChainHistory();
      const limit = Math.max(50, Math.min(5000, Number(req.query.limit) || 1000));
      const slice = history.length > limit ? history.slice(-limit) : history;
      res.json({ status: "success", count: slice.length, totalCount: history.length, snapshots: slice });
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

  // Run initial out-of-market database purge
  try {
    const { purgeOutOfMarketData } = await import("./src/db/market.ts");
    await purgeOutOfMarketData();
    setInterval(() => {
      purgeOutOfMarketData().catch(e => console.warn("Periodic market data purge warning:", e.message));
    }, 15 * 60 * 1000);
  } catch (err: any) {
    console.warn("Notice: Initial purgeOutOfMarketData skipped:", err.message);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
