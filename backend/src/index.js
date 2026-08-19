import express from "express";
import cors from "cors";
import {
  ensureSchema,
  getStorageValue,
  setStorageValue,
  waitForDb,
  pingDb,
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

app.get("/api/storage/:key", requireDb, async (req, res) => {
  try {
    const value = await getStorageValue(req.params.key);
    if (value === null) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(value);
  } catch (err) {
    console.error("GET storage error:", err);
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

app.put("/api/storage/:key", requireDb, async (req, res) => {
  try {
    if (req.body === undefined) {
      return res.status(400).json({ error: "missing_body" });
    }
    await setStorageValue(req.params.key, unwrapStorageBody(req.body));
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT storage error:", err);
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "invalid_json" });
  }
  return next(err);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on 0.0.0.0:${PORT}`);
});

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
})();
