import pg from "pg";

const { Pool } = pg;

let pool;

function poolConfig() {
  if (process.env.PGHOST || process.env.POSTGRES_USER || process.env.POSTGRES_PASSWORD) {
    return {
      host: process.env.PGHOST || "db",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.POSTGRES_USER || "thc_user",
      password: process.env.POSTGRES_PASSWORD || "thc_secret",
      database: process.env.POSTGRES_DB || "thc_db",
    };
  }
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: "db",
    port: 5432,
    user: "thc_user",
    password: "thc_secret",
    database: "thc_db",
  };
}

export function getPool() {
  if (!pool) {
    const cfg = poolConfig();
    const { password, connectionString, ...safe } = cfg;
    console.log("DB config:", safe.host
      ? `host=${safe.host} port=${safe.port} user=${safe.user} db=${safe.database}`
      : `connectionString=${(connectionString || "").replace(/:[^:@/]+@/, ":****@")}`);
    pool = new Pool(cfg);
  }
  return pool;
}

export async function waitForDb(maxAttempts = 10, delayMs = 2000) {
  const client = getPool();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.query("SELECT 1");
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.log(`Database not ready (attempt ${attempt}/${maxAttempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function pingDb() {
  await getPool().query("SELECT 1");
}

export async function ensureSchema() {
  await ensureSnapshotsTable();
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

/* ------------------------------------------------------------------ */
/*  Snapshots, state and atomic list operations                        */
/* ------------------------------------------------------------------ */

const SNAPSHOT_KEEP_DAYS = 60;

export async function ensureSnapshotsTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS app_storage_snapshots (
      id        BIGSERIAL PRIMARY KEY,
      taken_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      key       TEXT NOT NULL,
      value     JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_storage_snapshots_taken ON app_storage_snapshots (taken_at);
  `);
}

/** Copies every key once a day (kept SNAPSHOT_KEEP_DAYS days), so a bad import or mass delete can be undone. */
export async function snapshotIfDue() {
  await ensureSnapshotsTable();
  const recent = await getPool().query(
    `SELECT 1 FROM app_storage_snapshots WHERE taken_at > NOW() - INTERVAL '20 hours' LIMIT 1`
  );
  if (recent.rows.length) return 0;
  const res = await getPool().query(
    `INSERT INTO app_storage_snapshots (key, value) SELECT key, value FROM app_storage`
  );
  await getPool().query(
    `DELETE FROM app_storage_snapshots WHERE taken_at < NOW() - make_interval(days => $1)`,
    [SNAPSHOT_KEEP_DAYS]
  );
  return res.rowCount;
}

/** Older clients stored some values as JSON strings or as { wrapped, value }. */
function normalizeStored(value) {
  let v = value;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return v; }
  }
  if (v && typeof v === "object" && !Array.isArray(v) && v.wrapped === true && "value" in v) return v.value;
  return v;
}

export async function getVersion() {
  const { rows } = await getPool().query(`SELECT COALESCE(MAX(updated_at), 'epoch')::text AS v FROM app_storage`);
  return rows[0].v;
}

export async function getState() {
  const { rows } = await getPool().query(`SELECT key, value FROM app_storage`);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, normalizeStored(r.value)]));
  const list = (v) => (Array.isArray(v) ? v : []);
  const settings = byKey["th-settings"];
  return {
    settings: settings && typeof settings === "object" && !Array.isArray(settings) ? settings : null,
    teachers: list(byKey["th-entries-teachers"]),
    instructors: list(byKey["th-entries-instructors"]),
    archives: list(byKey["th-archives"]),
    lastExportAt: byKey["th-last-export"] ?? null,
    version: await getVersion(),
  };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const text = (v, max = 120) => (v == null ? "" : String(v).trim().slice(0, max));

/** A clean entry, or an error message. Required: name, a YYYY-MM-DD date, hours > 0. */
export function cleanEntry(raw, { partial = false } = {}) {
  if (!raw || typeof raw !== "object") return { error: "רשומה לא תקינה" };
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(raw, k);
  for (const k of ["name", "subject", "grade", "parallel", "reason"]) if (!partial || has(k)) out[k] = text(raw[k]);
  if (!partial || has("comment")) out.comment = text(raw.comment, 1000);
  if (!partial || has("date")) {
    const date = text(raw.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: `תאריך לא תקין: ${raw.date ?? ""}` };
    out.date = date;
  }
  if (!partial || has("hours")) {
    const hours = Number(raw.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 100) return { error: `כמות שעות לא תקינה: ${raw.hours ?? ""}` };
    out.hours = hours;
  }
  if (!partial && !out.name) return { error: "חסר שם" };
  if (partial && has("name") && !out.name) return { error: "חסר שם" };
  return { entry: out };
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * Runs fn({ key: currentValue }) -> { next: { key: nextValue }, result } inside one transaction,
 * with every row locked, so changes across keys land together or not at all.
 * `defaults` is { key: emptyValue }; keys are locked in sorted order.
 */
async function withLockedKeys(defaults, fn) {
  const keys = Object.keys(defaults).sort();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = {};
    for (const key of keys) {
      await client.query(
        `INSERT INTO app_storage (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(defaults[key])]
      );
      const { rows } = await client.query(`SELECT value FROM app_storage WHERE key = $1 FOR UPDATE`, [key]);
      current[key] = normalizeStored(rows[0]?.value);
    }
    const { next, result } = fn(current);
    for (const key of keys) {
      await client.query(
        `UPDATE app_storage SET value = $2::jsonb, updated_at = NOW() WHERE key = $1`,
        [key, JSON.stringify(next[key])]
      );
    }
    const v = await client.query(`SELECT updated_at::text AS v FROM app_storage WHERE key = $1`, [keys[0]]);
    await client.query("COMMIT");
    return { ...result, version: v.rows[0].v };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Runs fn(currentValue) -> { next, result } on one key. */
function withLockedKey(key, empty, fn) {
  return withLockedKeys({ [key]: empty }, (current) => {
    const { next, result } = fn(current[key]);
    return { next: { [key]: next }, result };
  });
}

export async function applyEntryOps(key, ops) {
  const add = Array.isArray(ops.add) ? ops.add : [];
  const update = Array.isArray(ops.update) ? ops.update : [];
  const remove = new Set((Array.isArray(ops.remove) ? ops.remove : []).map(String));
  if (add.length + update.length + remove.size === 0) throw badRequest("אין פעולות");

  const added = [];
  for (const raw of add) {
    const { entry, error } = cleanEntry(raw);
    if (error) throw badRequest(error);
    const id = text(raw.id, 40) || newId();
    added.push({ ...entry, id, createdAt: Number(raw.createdAt) || Date.now() });
  }
  const patches = [];
  for (const raw of update) {
    const id = text(raw?.id, 40);
    if (!id) throw badRequest("עדכון בלי מזהה");
    const { entry, error } = cleanEntry(raw, { partial: true });
    if (error) throw badRequest(error);
    patches.push({ id, entry });
  }

  return withLockedKey(key, [], (current) => {
    let list = Array.isArray(current) ? current : [];
    const before = list.length;
    if (remove.size) list = list.filter((e) => !remove.has(String(e.id)));
    const removed = before - list.length;
    let updated = 0;
    if (patches.length) {
      const byId = new Map(patches.map((p) => [p.id, p.entry]));
      list = list.map((e) => {
        const patch = byId.get(String(e.id));
        if (!patch) return e;
        updated += 1;
        return { ...e, ...patch, id: e.id, updatedAt: Date.now() };
      });
    }
    const ids = new Set(list.map((e) => String(e.id)));
    const fresh = added.filter((e) => !ids.has(e.id));
    list = [...list, ...fresh];
    return { next: list, result: { added: fresh, removed, updated, count: list.length } };
  });
}

export async function applyArchiveOps(ops) {
  const add = Array.isArray(ops.add) ? ops.add : [];
  const remove = new Set((Array.isArray(ops.remove) ? ops.remove : []).map(String));
  const fresh = add.map((a) => {
    if (!a || !text(a.label)) throw badRequest("לארכיון חסר שם");
    return {
      id: text(a.id, 40) || newId(),
      label: text(a.label),
      createdAt: Number(a.createdAt) || Date.now(),
      teacherEntries: Array.isArray(a.teacherEntries) ? a.teacherEntries : [],
      instructorEntries: Array.isArray(a.instructorEntries) ? a.instructorEntries : [],
    };
  });
  return withLockedKey("th-archives", [], (current) => {
    let list = Array.isArray(current) ? current : [];
    list = list.filter((a) => !remove.has(String(a.id)));
    const ids = new Set(list.map((a) => String(a.id)));
    list = [...list, ...fresh.filter((a) => !ids.has(a.id))];
    return { next: list, result: { count: list.length } };
  });
}

/**
 * Renames a person in the names list, their teams and all of their entries, as one change.
 * Refuses a name already in use: that would silently merge two people's records.
 */
export async function renamePerson(entriesKey, namesKey, teamKey, rawFrom, rawTo) {
  const from = String(rawFrom ?? "");
  const to = text(rawTo);
  if (!from || !to) throw badRequest("חסר שם");
  if (from === to) throw badRequest("השם לא השתנה");
  return withLockedKeys({ [entriesKey]: [], "th-settings": {} }, (current) => {
    const settings = current["th-settings"] && typeof current["th-settings"] === "object" && !Array.isArray(current["th-settings"]) ? current["th-settings"] : {};
    const names = Array.isArray(settings[namesKey]) ? settings[namesKey] : [];
    const entries = Array.isArray(current[entriesKey]) ? current[entriesKey] : [];
    const inEntries = (name) => entries.some((e) => e.name === name);
    if (!names.includes(from) && !inEntries(from)) throw badRequest(`השם "${from}" לא נמצא. רעננו את הדף ונסו שוב.`);
    if (names.includes(to) || inEntries(to)) throw badRequest(`השם "${to}" כבר קיים`);
    let updated = 0;
    const now = Date.now();
    const nextEntries = entries.map((e) => {
      if (e.name !== from) return e;
      updated += 1;
      return { ...e, name: to, updatedAt: now };
    });
    const nextSettings = { ...settings, [namesKey]: names.map((n) => (n === from ? to : n)) };
    if (Array.isArray(settings.teams)) {
      nextSettings.teams = settings.teams.map((team) => (
        Array.isArray(team[teamKey]) ? { ...team, [teamKey]: team[teamKey].map((n) => (n === from ? to : n)) } : team
      ));
    }
    return {
      next: { [entriesKey]: nextEntries, "th-settings": nextSettings },
      result: { updated, name: to },
    };
  });
}

/** Top-level settings keys in the patch replace the stored ones; other keys stay. */
export async function mergeSettings(patch) {
  return withLockedKey("th-settings", {}, (current) => {
    const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    const next = { ...base, ...patch };
    return { next, result: { settings: next } };
  });
}
