const fs = require('fs');
let code = fs.readFileSync('src/db/market.ts', 'utf8');

// Update imports
code = code.replace(
  "import { sql, eq, and, desc, gte } from 'drizzle-orm';",
  "import { sql, eq, and, desc, gte, lt } from 'drizzle-orm';"
);

// Update insertTick
const oldInsertTick = `export async function insertTick(instrument: string, price: number, timestamp: number) {
  try {
    await db.insert(ticks).values({
      instrument,
      price,
      timestamp: new Date(timestamp),
    });
    // Build candles
    await buildCandles(instrument, timestamp);
  } catch (error) {
    console.error("Failed to insert tick:", error);
  }
}`;

const newInsertTick = `export async function insertTick(
  instrument: string,
  price: number,
  timestamp: number,
): Promise<boolean> {
  if (
    !instrument ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(timestamp)
  ) {
    return false;
  }
  try {
    await db.insert(ticks).values({
      instrument,
      price,
      timestamp: new Date(timestamp),
    });
    await buildCandles(instrument, timestamp);
    return true;
  } catch (error) {
    console.error('Failed to insert tick:', error);
    return false;
  }
}`;

code = code.replace(oldInsertTick, newInsertTick);

// Update allTicks query
const oldAllTicks = `const allTicks = await db.select().from(ticks).where(
        and(
          eq(ticks.instrument, instrument),
          gte(ticks.timestamp, candleStart)
        )
      ).orderBy(ticks.timestamp);`;

const newAllTicks = `const allTicks = await db
        .select()
        .from(ticks)
        .where(
          and(
            eq(ticks.instrument, instrument),
            gte(ticks.timestamp, candleStart),
            lt(ticks.timestamp, candleEnd),
          ),
        )
        .orderBy(ticks.timestamp);`;
        
code = code.replace(oldAllTicks, newAllTicks);

fs.writeFileSync('src/db/market.ts', code);
console.log('market.ts updated');
