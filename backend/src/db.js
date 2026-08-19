import pg from "pg";

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return pool;
}

export async function waitForDb(maxAttempts = 30, delayMs = 2000) {
  const client = getPool();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.query("SELECT 1");
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.log(`Database not ready (attempt ${attempt}/${maxAttempts}), retrying...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function ensureSchema() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS app_storage (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getStorageValue(key) {
  const { rows } = await getPool().query(
    "SELECT value FROM app_storage WHERE key = $1",
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setStorageValue(key, value) {
  const payload = value === undefined ? null : value;
  await getPool().query(
    `INSERT INTO app_storage (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(payload)]
  );
}
