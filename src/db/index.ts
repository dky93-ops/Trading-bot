import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      idleTimeoutMillis: 10000, // Close idle clients after 10s to prevent server-side termination
      connectionTimeoutMillis: 15000,
      keepAlive: true,
    });

    global._postgresPool.on('error', (err: any) => {
      // Gracefully log idle connection disconnections without throwing uncaught errors
      if (err?.message?.includes('Connection terminated unexpectedly') || err?.code === 'ECONNRESET') {
        console.warn('Idle SQL pool connection closed by server, client will reconnect on next query.');
      } else {
        console.error('Unexpected error on idle SQL pool client:', err);
      }
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
