import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
