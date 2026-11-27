export type TradeNotificationKind = 'TRADE_OPENED' | 'TRADE_CLOSED' | 'SETUP_PENDING';

export type TradeNotificationSource =
  | 'LIVE_CHART'
  | 'STRATEGY_ENGINE'
  | 'SERVER_SAM_WATCHER'
  | 'TEST';

export interface TradeNotificationEvent {
  id: string;
  kind: TradeNotificationKind;
  direction: 'CALL' | 'PUT';
  signal: string;
  source: TradeNotificationSource;
  timestamp: number; // UTC ms
  candleTimeSec?: number;
  entryPrice: number;
  stoploss?: number;
  target?: number;
  exitPrice?: number;
  exitReason?: string;
  status?: 'OPEN' | 'WIN' | 'LOSS' | 'BE';
  spotPnl?: number;
  optionStrike?: number;
  optionType?: 'CE' | 'PE';
  optionEntryPremium?: number;
  optionExitPremium?: number;
  premiumPnl?: number;
  lotPnl?: number;
  message?: string;
}

/**
 * Idempotently prepends a notification event (skips duplicates by id).
 */
export function mergeNotificationIdempotent(
  existing: TradeNotificationEvent[],
  incoming: TradeNotificationEvent,
  maxItems: number = 60
): { list: TradeNotificationEvent[]; added: boolean } {
  if (!incoming || !incoming.id) {
    return { list: existing, added: false };
  }
  if (existing.some((item) => item.id === incoming.id)) {
    return { list: existing, added: false };
  }
  const next = [incoming, ...existing].slice(0, maxItems);
  return { list: next, added: true };
}

/**
 * Checks whether a chart candle timestamp (UTC epoch seconds shifted by +19800 IST)
 * is fresh/live relative to current wall-clock time so historical backtest bars
 * never trigger false real-time notifications.
 */
export function isFreshLiveCandleTime(
  chartTimeSec: number | undefined,
  nowMs: number = Date.now(),
  maxAgeMinutes: number = 5
): boolean {
  if (!chartTimeSec || !Number.isFinite(chartTimeSec)) return false;
  const candleUtcMs = (chartTimeSec - 19800) * 1000;
  const ageMs = nowMs - candleUtcMs;
  // Allow slight clock skew (-2 min) up to maxAgeMinutes in the past
  return ageMs >= -2 * 60_000 && ageMs <= maxAgeMinutes * 60_000;
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

export function unlockAudioContext(): void {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch {
    // ignore audio unlock errors
  }
}

function playToneSequence(
  notes: Array<{ freq: number; startOffset: number; duration: number; gain: number; type?: OscillatorType }>
): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = note.type || 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.startOffset);

      gainNode.gain.setValueAtTime(0.0001, now + note.startOffset);
      gainNode.gain.exponentialRampToValueAtTime(note.gain, now + note.startOffset + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.startOffset + note.duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now + note.startOffset);
      osc.stop(now + note.startOffset + note.duration + 0.02);
    }
  } catch {
    // ignore Web Audio failures on restricted environments
  }
}

/**
 * Plays a distinct real-time audio chime based on trade direction and event type.
 */
export function playTradeAlertSound(event: TradeNotificationEvent): void {
  if (event.kind === 'SETUP_PENDING') {
    playToneSequence([
      { freq: 880, startOffset: 0, duration: 0.14, gain: 0.14, type: 'sine' },
      { freq: 1046.5, startOffset: 0.16, duration: 0.18, gain: 0.12, type: 'sine' },
    ]);
    return;
  }

  if (event.kind === 'TRADE_OPENED') {
    if (event.direction === 'CALL') {
      // Crisp ascending CALL entry chime (C5 -> E5 -> G5)
      playToneSequence([
        { freq: 523.25, startOffset: 0, duration: 0.14, gain: 0.2, type: 'triangle' },
        { freq: 659.25, startOffset: 0.12, duration: 0.14, gain: 0.22, type: 'triangle' },
        { freq: 783.99, startOffset: 0.24, duration: 0.28, gain: 0.25, type: 'sine' },
      ]);
    } else {
      // Distinct descending PUT entry chime (G5 -> E5 -> C5)
      playToneSequence([
        { freq: 783.99, startOffset: 0, duration: 0.14, gain: 0.2, type: 'triangle' },
        { freq: 659.25, startOffset: 0.12, duration: 0.14, gain: 0.22, type: 'triangle' },
        { freq: 523.25, startOffset: 0.24, duration: 0.28, gain: 0.25, type: 'sine' },
      ]);
    }
    return;
  }

  // TRADE_CLOSED
  const lotNum = typeof event.lotPnl === 'number' && Number.isFinite(event.lotPnl) ? event.lotPnl : undefined;
  const spotNum = typeof event.spotPnl === 'number' && Number.isFinite(event.spotPnl) ? event.spotPnl : undefined;
  if (event.status === 'WIN' || (lotNum !== undefined && lotNum > 0) || (spotNum !== undefined && spotNum > 0)) {
    playToneSequence([
      { freq: 783.99, startOffset: 0, duration: 0.14, gain: 0.22, type: 'sine' },
      { freq: 1046.5, startOffset: 0.14, duration: 0.3, gain: 0.24, type: 'sine' },
    ]);
  } else if (event.status === 'LOSS' || (lotNum !== undefined && lotNum < 0) || (spotNum !== undefined && spotNum < 0)) {
    playToneSequence([
      { freq: 311.13, startOffset: 0, duration: 0.16, gain: 0.2, type: 'sawtooth' },
      { freq: 246.94, startOffset: 0.18, duration: 0.26, gain: 0.18, type: 'sawtooth' },
    ]);
  } else {
    playToneSequence([
      { freq: 659.25, startOffset: 0, duration: 0.15, gain: 0.16, type: 'sine' },
      { freq: 659.25, startOffset: 0.18, duration: 0.18, gain: 0.16, type: 'sine' },
    ]);
  }
}

export function formatTradeNotificationTitle(event: TradeNotificationEvent): string {
  const strikePart = event.optionStrike
    ? `${event.optionStrike} ${event.optionType || (event.direction === 'CALL' ? 'CE' : 'PE')}`
    : `NIFTY ${event.direction}`;

  if (event.kind === 'SETUP_PENDING') {
    return `PENDING ${event.direction} SETUP • ${strikePart}`;
  }
  if (event.kind === 'TRADE_CLOSED') {
    const statusLabel = event.status || 'CLOSED';
    return `TRADE ${statusLabel} • ${strikePart}`;
  }
  return `NEW ${event.direction} TRADE • ${strikePart}`;
}

export function formatTradeNotificationBody(event: TradeNotificationEvent): string {
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const parts: string[] = [];
  if (event.signal) parts.push(event.signal);
  if (event.kind === 'TRADE_CLOSED') {
    if (isNum(event.entryPrice) && isNum(event.exitPrice)) {
      parts.push(`Spot ${event.entryPrice.toFixed(1)} → ${event.exitPrice.toFixed(1)}`);
    }
    if (isNum(event.lotPnl)) {
      parts.push(`1 Lot: ${event.lotPnl >= 0 ? '+' : ''}₹${event.lotPnl.toFixed(0)}`);
    } else if (isNum(event.spotPnl)) {
      parts.push(`Spot P&L: ${event.spotPnl >= 0 ? '+' : ''}${event.spotPnl.toFixed(1)} pts`);
    }
    if (event.exitReason) parts.push(event.exitReason);
  } else {
    if (isNum(event.entryPrice)) parts.push(`Spot: ${event.entryPrice.toFixed(2)}`);
    if (isNum(event.stoploss)) parts.push(`SL: ${event.stoploss.toFixed(1)}`);
    if (isNum(event.target)) parts.push(`TP: ${event.target.toFixed(1)}`);
    if (isNum(event.optionEntryPremium)) {
      parts.push(`Prem: ₹${event.optionEntryPremium.toFixed(2)}`);
    }
  }
  return parts.join(' | ');
}

/**
 * Fires a native browser/OS desktop notification when permission has been granted.
 */
export function showBrowserTradeNotification(event: TradeNotificationEvent): void {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const n = new Notification(formatTradeNotificationTitle(event), {
      body: formatTradeNotificationBody(event),
      tag: event.id,
      requireInteraction: event.kind === 'TRADE_OPENED',
    });

    n.onclick = () => {
      try {
        window.focus();
        n.close();
      } catch {
        // ignore focus errors
      }
    };
  } catch {
    // ignore browser notification failures (e.g. sandboxed iframe)
  }
}

export function formatIstTimeWithSeconds(tsMs: number): string {
  try {
    return new Date(tsMs).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}
