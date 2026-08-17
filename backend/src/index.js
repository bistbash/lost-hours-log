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
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await getStorageValue("__health__");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "error", message: err.message });
  }
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
    await setStorageValue(req.params.key, req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT storage error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

async function start() {
  await waitForDb();
  await ensureSchema();
  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
