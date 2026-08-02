import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, doublePrecision } from 'drizzle-orm/pg-core';

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
