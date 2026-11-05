import express from "express";
import cors from "cors";
import {
  applyArchiveOps,
  applyEntryOps,
  ensureSchema,
  getState,
  getStorageValue,
  getVersion,
  mergeSettings,
  pingDb,
  renamePerson,
  setStorageValue,
  snapshotIfDue,
  waitForDb,
} from "./db.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

let dbReady = false;
let dbError = null;

app.use(cors());
app.use(express.json({ limit: "50mb", strict: false }));

app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  next();
});

/** The only keys the app stores. Anything else is refused. */
const KNOWN_KEYS = new Set(["th-settings", "th-entries-teachers", "th-entries-instructors", "th-last-export", "th-archives"]);
/** Lists that are only changed through operations, so two people editing at once never overwrite each other. */
const OPS_ONLY_KEYS = new Set(["th-entries-teachers", "th-entries-instructors", "th-archives"]);

function unwrapStorageBody(body) {
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    body.wrapped === true &&
    Object.prototype.hasOwnProperty.call(body, "value")
  ) {
    return body.value;
  }
  return body;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wraps an async handler: HttpError -> its status, anything else -> 500. */
const route = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError || err.status) {
      return res.status(err.status).json({ error: "bad_request", message: err.message });
    }
    console.error(`${req.method} ${req.path} error:`, err);
    res.status(500).json({ error: "internal_error", message: err.message });
  }
};

app.get("/api/health", async (_req, res) => {
  if (!dbReady) {
    return res.status(200).json({
      status: "starting",
      db: "not_ready",
      error: dbError ? String(dbError.message || dbError) : null,
    });
  }
  try {
    await pingDb();
    res.json({ status: "ok", db: "ready" });
  } catch (err) {
    res.status(200).json({
      status: "degraded",
      db: "error",
      error: err.message,
    });
  }
});

function requireDb(_req, res, next) {
  if (!dbReady) {
    return res.status(503).json({
      error: "db_not_ready",
      message: dbError ? String(dbError.message || dbError) : "database still initializing",
    });
  }
  return next();
}

/** Everything the app shows, in one request, with the version used to notice changes by others. */
app.get("/api/state", requireDb, route(async (_req, res) => {
  res.json(await getState());
}));

/** Cheap poll: the latest change time across all keys. */
app.get("/api/version", requireDb, route(async (_req, res) => {
  res.json({ version: await getVersion() });
}));

const ENTRY_KIND = { teachers: "th-entries-teachers", instructors: "th-entries-instructors" };
const NAMES_KIND = { teachers: "teacherNames", instructors: "instructorNames" };

/** Body: { add?: Entry[], update?: Entry[] (by id), remove?: id[] }. Applied atomically on the server. */
app.post("/api/entries/:kind/ops", requireDb, route(async (req, res) => {
  const key = ENTRY_KIND[req.params.kind];
  if (!key) throw new HttpError(404, "unknown list");
  res.json(await applyEntryOps(key, req.body || {}));
}));

/** Body: { from, to }. Changes the name in the settings list and in that person's entries together. */
app.post("/api/people/:kind/rename", requireDb, route(async (req, res) => {
  const key = ENTRY_KIND[req.params.kind];
  if (!key) throw new HttpError(404, "unknown list");
  const { from, to } = req.body || {};
  res.json(await renamePerson(key, NAMES_KIND[req.params.kind], from, to));
}));

/** Body: { add?: Archive[], remove?: id[] }. */
app.post("/api/archives/ops", requireDb, route(async (req, res) => {
  res.json(await applyArchiveOps(req.body || {}));
}));

/** Body: a partial settings object; its top-level keys replace the stored ones. */
app.patch("/api/settings", requireDb, route(async (req, res) => {
  const patch = req.body;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HttpError(400, "settings patch must be an object");
  res.json(await mergeSettings(patch));
}));

app.get("/api/storage/:key", requireDb, route(async (req, res) => {
  if (!KNOWN_KEYS.has(req.params.key)) throw new HttpError(404, "unknown key");
  const value = await getStorageValue(req.params.key);
  if (value === null) {
    return res.status(404).json({ error: "not_found" });
  }
  res.json(value);
}));

app.put("/api/storage/:key", requireDb, route(async (req, res) => {
  const key = req.params.key;
  if (!KNOWN_KEYS.has(key)) throw new HttpError(404, "unknown key");
  // Tabs still running the old version saved whole lists, which wiped other people's changes.
  if (OPS_ONLY_KEYS.has(key)) {
    return res.status(409).json({ error: "outdated_client", message: "המערכת עודכנה. רעננו את הדף (F5) כדי להמשיך לשמור." });
  }
  if (req.body === undefined) {
    return res.status(400).json({ error: "missing_body" });
  }
  await setStorageValue(key, unwrapStorageBody(req.body));
  res.json({ ok: true });
}));

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "invalid_json" });
  }
  return next(err);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on 0.0.0.0:${PORT}`);
});

async function runSnapshots() {
  try {
    const taken = await snapshotIfDue();
    if (taken) console.log(`Daily snapshot saved (${taken} keys).`);
  } catch (err) {
    console.error("Snapshot failed:", err.message);
  }
}

(async function initDb() {
  while (!dbReady) {
    try {
      console.log("Connecting to database...");
      await waitForDb();
      await ensureSchema();
      dbReady = true;
      dbError = null;
      console.log("Database ready.");
    } catch (err) {
      dbError = err;
      console.error("Database init failed, retrying in 5s:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await runSnapshots();
  setInterval(runSnapshots, 6 * 60 * 60 * 1000);
})();
