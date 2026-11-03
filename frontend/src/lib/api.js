/**
 * Server API. Lists (entries, archives) are changed through operations applied atomically on the server,
 * so two people working at the same time never overwrite each other's changes.
 */

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || `HTTP ${res.status}`);
    err.status = res.status;
    err.retriable = res.status === 503 || res.status === 502;
    throw err;
  }
  return data;
}

/** { settings, teachers, instructors, archives, lastExportAt, version } */
export const fetchState = () => request("GET", "/api/state");
export const fetchVersion = () => request("GET", "/api/version").then((d) => d.version);

/** kind: "teachers" | "instructors"; ops: { add?, update?, remove? } */
export const entryOps = (kind, ops) => request("POST", `/api/entries/${kind}/ops`, ops);
export const archiveOps = (ops) => request("POST", "/api/archives/ops", ops);
export const patchSettings = (patch) => request("PATCH", "/api/settings", patch);
export const saveLastExport = (ts) => request("PUT", "/api/storage/th-last-export", { value: ts, wrapped: true });
