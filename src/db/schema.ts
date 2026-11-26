import { relations } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const ticks = pgTable('ticks', {
  id: serial('id').primaryKey(),
  instrument: text('instrument').notNull(), // e.g., NIFTY, BANKNIFTY
  price: doublePrecision('price').notNull(),
  timestamp: timestamp('timestamp').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Since user asked for 3-min, 5-min, and 15-min historical candles.
export const candles = pgTable('candles', {
  id: serial('id').primaryKey(),
  instrument: text('instrument').notNull(),
  timeframe: integer('timeframe').notNull(), // e.g., 3, 5, 15
  open: doublePrecision('open').notNull(),
  high: doublePrecision('high').notNull(),
  low: doublePrecision('low').notNull(),
  close: doublePrecision('close').notNull(),
  volume: doublePrecision('volume').default(0),
  timestamp: timestamp('timestamp').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const optionChainSnapshots = pgTable(
  'option_chain_snapshots',
  {
    id: serial('id').primaryKey(),
    snapshotId: text('snapshot_id').notNull().unique(),
    timestamp: timestamp('timestamp').notNull(),
    timestampMs: bigint('timestamp_ms', { mode: 'number' }).notNull(),
    timeIso: text('time_iso').notNull(),
    instrumentKey: text('instrument_key').notNull(),
    expiryDate: text('expiry_date').notNull(),
    spotPrice: doublePrecision('spot_price').notNull(),
    totalCallOi: doublePrecision('total_call_oi').default(0).notNull(),
    totalPutOi: doublePrecision('total_put_oi').default(0).notNull(),
    pcr: doublePrecision('pcr').default(0).notNull(),
    maxCallOiStrike: doublePrecision('max_call_oi_strike').default(0).notNull(),
    maxPutOiStrike: doublePrecision('max_put_oi_strike').default(0).notNull(),
    strikeCount: integer('strike_count').default(0).notNull(),
    ceWalls: jsonb('ce_walls').$type<any[]>().default([]).notNull(),
    peWalls: jsonb('pe_walls').$type<any[]>().default([]).notNull(),
    rows: jsonb('rows').$type<any[]>().notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('option_chain_snapshots_instr_ts_idx').on(table.instrumentKey, table.timestampMs),
  ]
);
