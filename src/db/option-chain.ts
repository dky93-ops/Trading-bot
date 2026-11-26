import { asc, desc } from 'drizzle-orm';
import { db } from './index.ts';
import { optionChainSnapshots } from './schema.ts';
import type { OptionChainSnapshot } from '../backend/types.js';

function toDbRecord(snap: OptionChainSnapshot) {
  const tsMs = Number(snap.timestamp);
  const safeTsMs = Number.isFinite(tsMs) && tsMs > 0 ? Math.floor(tsMs) : Date.now();
  const rows = Array.isArray(snap.rows) ? snap.rows : [];
  return {
    snapshotId: String(snap.id || `OC_1M_${safeTsMs}`),
    timestamp: new Date(safeTsMs),
    timestampMs: safeTsMs,
    timeIso: String(snap.timeISO || new Date(safeTsMs).toISOString()),
    instrumentKey: String(snap.instrumentKey || 'NSE_INDEX|Nifty 50'),
    expiryDate: String(snap.expiryDate || 'CURRENT'),
    spotPrice: Number.isFinite(Number(snap.spotPrice)) ? Number(snap.spotPrice) : 0,
    totalCallOi: Number.isFinite(Number(snap.totalCallOI)) ? Number(snap.totalCallOI) : 0,
    totalPutOi: Number.isFinite(Number(snap.totalPutOI)) ? Number(snap.totalPutOI) : 0,
    pcr: Number.isFinite(Number(snap.pcr)) ? Number(snap.pcr) : 0,
    maxCallOiStrike: Number.isFinite(Number(snap.maxCallOIStrike)) ? Number(snap.maxCallOIStrike) : 0,
    maxPutOiStrike: Number.isFinite(Number(snap.maxPutOIStrike)) ? Number(snap.maxPutOIStrike) : 0,
    strikeCount: Number.isFinite(Number(snap.strikeCount)) ? Number(snap.strikeCount) : rows.length,
    ceWalls: Array.isArray(snap.ceWalls) ? snap.ceWalls : [],
    peWalls: Array.isArray(snap.peWalls) ? snap.peWalls : [],
    rows,
  };
}

function fromDbRow(row: typeof optionChainSnapshots.$inferSelect): OptionChainSnapshot {
  return {
    id: row.snapshotId,
    timestamp: Number(row.timestampMs),
    timeISO: row.timeIso,
    instrumentKey: row.instrumentKey,
    expiryDate: row.expiryDate,
    spotPrice: Number(row.spotPrice),
    totalCallOI: Number(row.totalCallOi),
    totalPutOI: Number(row.totalPutOi),
    pcr: Number(row.pcr),
    maxCallOIStrike: Number(row.maxCallOiStrike),
    maxPutOIStrike: Number(row.maxPutOiStrike),
    strikeCount: Number(row.strikeCount),
    ceWalls: Array.isArray(row.ceWalls) ? row.ceWalls : [],
    peWalls: Array.isArray(row.peWalls) ? row.peWalls : [],
    rows: Array.isArray(row.rows) ? row.rows : [],
  };
}

export async function saveOptionChainSnapshotToDb(snap: OptionChainSnapshot): Promise<boolean> {
  try {
    const record = toDbRecord(snap);
    await db
      .insert(optionChainSnapshots)
      .values(record)
      .onConflictDoNothing({ target: optionChainSnapshots.snapshotId });
    return true;
  } catch (e: any) {
    console.error('[DB] Failed to save option chain snapshot:', e?.message || e);
    return false;
  }
}

export async function saveOptionChainSnapshotsBatchToDb(
  snaps: OptionChainSnapshot[]
): Promise<number> {
  if (!Array.isArray(snaps) || snaps.length === 0) return 0;
  let insertedBatches = 0;
  const chunkSize = 50;
  for (let i = 0; i < snaps.length; i += chunkSize) {
    const chunk = snaps.slice(i, i + chunkSize).map(toDbRecord);
    try {
      await db
        .insert(optionChainSnapshots)
        .values(chunk)
        .onConflictDoNothing({ target: optionChainSnapshots.snapshotId });
      insertedBatches += chunk.length;
    } catch (e: any) {
      console.error('[DB] Failed to batch-save option chain snapshots:', e?.message || e);
    }
  }
  return insertedBatches;
}

export async function loadOptionChainHistoryFromDb(
  limit: number = 5000
): Promise<OptionChainSnapshot[]> {
  try {
    const safeLimit = Math.max(1, Math.min(20000, Math.floor(limit)));
    // Fetch most recent `limit` snapshots, then return in ascending chronological order
    const rows = await db
      .select()
      .from(optionChainSnapshots)
      .orderBy(desc(optionChainSnapshots.timestampMs))
      .limit(safeLimit);

    return rows.reverse().map(fromDbRow);
  } catch (e: any) {
    console.error('[DB] Failed to load option chain history from database:', e?.message || e);
    return [];
  }
}

export async function clearOptionChainHistoryInDb(): Promise<boolean> {
  try {
    await db.delete(optionChainSnapshots);
    return true;
  } catch (e: any) {
    console.error('[DB] Failed to clear option chain history in database:', e?.message || e);
    return false;
  }
}
