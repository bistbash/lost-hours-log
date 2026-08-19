import express from "express";
import cors from "cors";
import {
  ensureSchema,
  getStorageValue,
  setStorageValue,
  waitForDb,
} from "./db.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb", strict: false }));

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
  try {
    await getStorageValue("__health__");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "error", message: err.message });
  }
});

app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  next();
});

app.get("/api/storage/:key", async (req, res) => {
  try {
    const value = await getStorageValue(req.params.key);
    if (value === null) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(value);
  } catch (err) {
    console.error("GET storage error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.put("/api/storage/:key", async (req, res) => {
  try {
    if (req.body === undefined) {
      return res.status(400).json({ error: "missing_body" });
    }
    await setStorageValue(req.params.key, unwrapStorageBody(req.body));
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT storage error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "invalid_json" });
  }
  return next(err);
});

async function start() {
  await waitForDb();
  await ensureSchema();
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Backend listening on 0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
