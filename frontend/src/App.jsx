import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Users, GraduationCap, BarChart3, Settings as SettingsIcon, Trophy,
  Plus, Trash2, Download, X, Eye, Pencil, Loader2, ChevronDown, Upload, Check, DatabaseBackup,
  LayoutDashboard, AlertTriangle, CloudDownload, Clock, TrendingUp, Flag, CalendarDays, Archive as ArchiveIcon, UserSearch
} from "lucide-react";
import * as XLSX from "xlsx";
import { archiveOps, entryOps, fetchState, fetchVersion, patchSettings, renamePerson, saveLastExport } from "./lib/api.js";
import { DAY_COLORS, MONTH_COLORS, fmt, inRange, people as peopleOf, searchKey } from "./lib/stats.js";
import { downloadBackup } from "./lib/backupReport.js";
import { NamePicker, RangeBar } from "./components/ui.jsx";
import ReportsTab from "./components/ReportsTab.jsx";
import PeopleTab from "./components/PeopleTab.jsx";
import OverviewTab from "./components/OverviewTab.jsx";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MONTH_NAMES = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

const dayOfWeekHebrew = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "";
  return DAY_NAMES[d.getDay()];
};
const monthHebrew = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "";
  return MONTH_NAMES[d.getMonth()];
};
const monthKey = (dateStr) => (dateStr ? dateStr.slice(0, 7) : "");
const monthKeyLabel = (key) => {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} '${y.slice(2)}`;
};
const dayBadgeStyle = (day) => {
  const c = DAY_COLORS[day] || { bg: "#EEE", fg: "#555" };
  return { background: c.bg, color: c.fg };
};
const monthBadgeStyle = (dateStr) => {
  if (!dateStr) return {};
  const idx = new Date(dateStr + "T00:00:00").getMonth();
  const c = MONTH_COLORS[idx] || { bg: "#EEE", fg: "#555" };
  return { background: c.bg, color: c.fg };
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const DEFAULT_SETTINGS = {
  // Staff names are entered in "הגדרות" (kept in the database, not in the source code).
  teacherNames: [],
  instructorNames: [],
  subjects: ["עברית", "אנגלית", "תנ\"ך", "נטרול מערכתי", "מחלה", "תרמודינמיקה", "חומרים מעובדים", "חוגש", "אזרחות", "מבחן/בוחן", "היסטוריה"],
  grades: ["י", "יא", "יב"],
  teacherReasons: [],
  instructorReasons: [],
  parallels: ["1", "2", "3", "4", "5", "6", "7", "8"],
  holidays: [],
  alertThreshold: 15,
};

const LOGO_DATA_URI = "/logo.png";
const SKY_BANNER_URI = "/banner.jpg";


function exportCSV(entries, filename) {
  const headers = ["שם", "מקצוע", "שכבה", "מספר כיתה", "תאריך", "יום", "חודש", "שעות", "סיבה", "הערה"];
  const escape = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  const rows = entries.map((e) =>
    [e.name, e.subject, e.grade, e.parallel, e.date, dayOfWeekHebrew(e.date), monthHebrew(e.date), e.hours, e.reason, e.comment]
      .map(escape)
      .join(",")
  );
  const csv = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Excel / CSV import helpers                                         */
/* ------------------------------------------------------------------ */

const HEADER_MAP = {
  name: ["שם", "איש סגל", "שם מורה", "שם מדריך", "שם עובד"],
  subject: ["מקצוע"],
  grade: ["שכבה"],
  parallel: ["מספר כיתה", "מקבילה", "כיתה"],
  date: ["תאריך"],
  hours: ["שעות מופסדות", "שעות שאבדו", "כמות שעות", "שעות"],
  reason: ["סיבה", "סיבת ביטול"],
  comment: ["הערה חופשית", "הערות", "הערה"],
};

function detectColumnMap(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const clean = (h ?? "").toString().trim();
    if (!clean) return;
    for (const [field, variants] of Object.entries(HEADER_MAP)) {
      if (map[field] != null) continue;
      if (variants.some((v) => clean === v || clean.includes(v))) map[field] = idx;
    }
  });
  return map;
}

function excelSerialToDateStr(serial) {
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function normalizeDate(val) {
  if (val instanceof Date && !isNaN(val)) {
    const y = val.getFullYear(), m = String(val.getMonth() + 1).padStart(2, "0"), d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "number") return excelSerialToDateStr(val);
  if (typeof val === "string") {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = "20" + y;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }
  return "";
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                              */
/* ------------------------------------------------------------------ */

function Chip({ children, onRemove, onEdit, className = "", ...rest }) {
  return (
    <span className={`thc-chip ${className}`.trim()} {...rest}>
      {children}
      {onEdit && (
        <button type="button" className="thc-chip-x" onClick={onEdit} aria-label="ערוך שם" title="עריכת שם">
          <Pencil size={11} />
        </button>
      )}
      {onRemove && (
        <button className="thc-chip-x" onClick={onRemove} aria-label="הסר">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/** `items` with `item` moved next to `target`: right after it when `after` is true, otherwise right before it. */
function moveItem(items, item, target, after) {
  if (item === target) return items;
  const rest = items.filter((x) => x !== item);
  const i = rest.indexOf(target);
  if (i < 0) return items;
  rest.splice(after ? i + 1 : i, 0, item);
  return rest;
}

const CHIP_DRAG_TYPE = "application/x-thc-chip"; // Not plain text, so a dropped chip never lands inside a text field.

/** A list of chips, reordered by dragging within the list. With `onRename`, each chip can also be renamed. */
function ListEditor({ title, items, onChange, onRename, countRecords }) {
  const [draft, setDraft] = useState("");
  const [dragged, setDragged] = useState(null);
  const [dropAt, setDropAt] = useState(null); // { item, after }
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  };
  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text");
    if (!text || !/[\r\n]/.test(text)) return; // single line — let normal paste happen
    e.preventDefault();
    const newItems = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !items.includes(s));
    const deduped = Array.from(new Set(newItems));
    if (deduped.length) onChange([...items, ...deduped]);
    setDraft("");
  };

  const allowDrop = (e) => { if (dragged !== null) e.preventDefault(); }; // Only this list's own chips can land here.
  const endDrag = () => { setDragged(null); setDropAt(null); };
  const dropSpot = (e, it) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { item: it, after: e.clientX < rect.left + rect.width / 2 }; // The page is right-to-left.
  };
  const finishDrop = (e, spot) => {
    e.preventDefault();
    if (dragged !== null && spot) onChange(moveItem(items, dragged, spot.item, spot.after));
    endDrag();
  };
  const dragProps = (it) => ({
    draggable: true,
    title: "גררו כדי לשנות את הסדר",
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(CHIP_DRAG_TYPE, it);
      setDragged(it);
      setNotice("");
    },
    onDragEnd: endDrag,
    onDragOver: (e) => {
      if (dragged === null) return;
      const spot = dropSpot(e, it);
      setDropAt((prev) => (prev && prev.item === spot.item && prev.after === spot.after ? prev : spot));
    },
    onDrop: (e) => {
      e.stopPropagation(); // A quick release can arrive before the last dragover has rendered.
      finishDrop(e, dropSpot(e, it));
    },
  });
  const chipClass = (it) => [
    it === dragged ? "is-dragging" : "",
    dropAt && dropAt.item === it && it !== dragged ? (dropAt.after ? "is-drop-after" : "is-drop-before") : "",
  ].filter(Boolean).join(" ");

  const startEdit = (it) => { setEditing(it); setEditValue(it); setEditError(""); setNotice(""); };
  const cancelEdit = () => { setEditing(null); setEditError(""); };
  const saveEdit = async () => {
    const next = editValue.trim();
    if (!next || next === editing) { cancelEdit(); return; }
    if (items.includes(next)) { setEditError(`השם "${next}" כבר קיים ברשימה`); return; }
    setSaving(true);
    const res = await onRename(editing, next);
    setSaving(false);
    if (!res) return; // The app's error banner explains what happened.
    setEditing(null);
    setEditError("");
    setNotice(res.updated ? `השם עודכן, כולל ${res.updated} רשומות קיימות` : "השם עודכן");
  };

  return (
    <div className="thc-list-editor">
      <h4>{title}</h4>
      <div className="thc-chip-row" onDragEnter={allowDrop} onDragOver={allowDrop} onDrop={(e) => finishDrop(e, dropAt)}>
        {items.length === 0 && <span className="thc-muted">אין פריטים עדיין</span>}
        {items.map((it) => (editing === it ? (
          <span key={it} className="thc-chip thc-chip-editing">
            <input
              autoFocus
              value={editValue}
              disabled={saving}
              aria-label="שם חדש"
              onChange={(e) => { setEditValue(e.target.value); setEditError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") cancelEdit();
              }}
            />
            <button type="button" className="thc-chip-x" onClick={saveEdit} disabled={saving} aria-label="שמור שם"><Check size={12} /></button>
            <button type="button" className="thc-chip-x" onClick={cancelEdit} disabled={saving} aria-label="בטל עריכה"><X size={12} /></button>
          </span>
        ) : (
          <Chip
            key={it}
            className={chipClass(it)}
            onEdit={onRename ? () => startEdit(it) : undefined}
            onRemove={() => onChange(items.filter((x) => x !== it))}
            {...dragProps(it)}
          >
            {it}
          </Chip>
        )))}
      </div>
      {editing !== null && (
        <p className={`thc-chip-note ${editError ? "is-error" : ""}`} role={editError ? "alert" : undefined}>
          {editError || `שינוי השם יעדכן גם ${countRecords(editing)} רשומות קיימות`}
        </p>
      )}
      {editing === null && notice && <p className="thc-chip-note is-done" role="status">{notice}</p>}
      <div className="thc-add-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          onPaste={handlePaste}
          placeholder="הוסף פריט חדש, או הדבק כאן רשימה שלמה (שורה לכל פריט)..."
        />
        <button onClick={add}><Plus size={16} /> הוסף</button>
      </div>
    </div>
  );
}

function HolidaysTab({ holidays, onChange, grades }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    if (!startDate || !name.trim()) {
      setError("יש למלא תאריך התחלה ושם חג/מועד");
      return;
    }
    const end = endDate || startDate;
    if (end < startDate) {
      setError("תאריך הסיום לא יכול להיות לפני תאריך ההתחלה");
      return;
    }
    setError("");
    const next = [...holidays, { startDate, endDate: end, name: name.trim(), grade }].sort((a, b) => a.startDate.localeCompare(b.startDate));
    onChange(next);
    setStartDate("");
    setEndDate("");
    setName("");
    setGrade("");
  };
  const remove = (idx) => onChange(holidays.filter((_, i) => i !== idx));

  return (
    <div className="thc-card">
      <h3>ניהול חגים, מועדים וטיולי שכבה</h3>
      <p className="thc-import-hint" style={{ marginBottom: 16 }}>
        הגדר טווח תאריכים לכל חג, מועד או טיול (ליום בודד פשוט השאר את "עד תאריך" ריק). אם תבחר "שכבה" ספציפית, האזהרה
        תופיע רק בהזנת רשומה לאותה שכבה (למשל טיול שנתי) — אם תשאיר "כל השכבות", האזהרה תחול על כולם (כמו חג רגיל).
        אם תבחר בטופס ההזנה תאריך שנופל בתוך אחד הטווחים, תוצג אזהרה עם אפשרות להמשיך בכל זאת.
      </p>
      <div className="thc-holiday-form">
        <Field label="מתאריך">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="עד תאריך (ליום בודד השאר ריק)">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="שכבה (אופציונלי)">
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">כל השכבות</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="שם החג / המועד / הטיול">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="לדוגמה: טיול שנתי י״ב" />
        </Field>
        <button className="thc-primary-btn thc-holiday-add-btn" onClick={add}><Plus size={16} /> הוסף</button>
      </div>
      {error && <p className="thc-error">{error}</p>}

      {holidays.length === 0 ? (
        <p className="thc-empty" style={{ marginTop: 18 }}>לא הוזנו חגים עדיין.</p>
      ) : (
        <div className="thc-holiday-list" style={{ marginTop: 18 }}>
          {holidays.map((h, i) => (
            <div key={i} className="thc-holiday-row">
              <span className="thc-holiday-date">
                {h.startDate}{h.endDate && h.endDate !== h.startDate ? ` – ${h.endDate}` : ""}
              </span>
              <span className="thc-holiday-name">{h.name}</span>
              <span className="thc-holiday-grade-tag">{h.grade ? `שכבה ${h.grade}` : "כל השכבות"}</span>
              <button className="thc-chip-x" onClick={() => remove(i)} aria-label="הסר">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="thc-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

const entryKey = (e) => [searchKey(e.name), e.date, searchKey(e.subject), Number(e.hours || 0)].join("|");

function ImportPanel({ onConfirm, colorAccent, sheetHint, existingEntries = [] }) {
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("file");
  const [pasteText, setPasteText] = useState("");
  const [parsedRows, setParsedRows] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [workbook, setWorkbook] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState("");

  const processAOA = (aoa) => {
    if (!aoa.length) { setParsedRows([]); setSkipped(0); return; }
    // Scan the first few rows to find the real header row (some exports have a
    // merged title row like "מורים" above the actual column headers).
    const maxScan = Math.min(5, aoa.length);
    let best = { idx: -1, count: 0, map: {} };
    for (let i = 0; i < maxScan; i++) {
      const row = (aoa[i] || []).map((c) => (c ?? "").toString().trim());
      const map = detectColumnMap(row);
      const count = Object.keys(map).length;
      if (count > best.count) best = { idx: i, count, map };
    }
    let colMap, dataRows;
    if (best.count >= 3) {
      colMap = best.map;
      dataRows = aoa.slice(best.idx + 1);
    } else {
      colMap = { name: 0, subject: 1, grade: 2, parallel: 3, date: 4, hours: 5, reason: 6, comment: 7 };
      dataRows = aoa;
    }
    const rows = [];
    let skippedCount = 0;
    dataRows.forEach((r) => {
      if (!r || r.every((c) => c === "" || c == null)) return;
      const get = (f) => (colMap[f] != null ? r[colMap[f]] : "");
      const name = (get("name") ?? "").toString().trim();
      const date = normalizeDate(get("date"));
      const hours = Number(get("hours"));
      if (!name || !date || !hours) { skippedCount++; return; }
      rows.push({
        name,
        subject: (get("subject") ?? "").toString().trim(),
        grade: (get("grade") ?? "").toString().trim(),
        parallel: (get("parallel") ?? "").toString().trim(),
        date,
        hours,
        reason: (get("reason") ?? "").toString().trim(),
        comment: (get("comment") ?? "").toString().trim(),
      });
    });
    // Rows already in the system (same name, date, subject and hours) or repeated in the file.
    const seen = new Set(existingEntries.map(entryKey));
    for (const r of rows) {
      const k = entryKey(r);
      r.duplicate = seen.has(k);
      seen.add(k);
    }
    setParsedRows(rows);
    setSkipped(skippedCount);
  };

  const parseSheet = (wb, sheetName) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    processAOA(aoa);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" }); // Dates stay Excel serials: cellDates shifts them a day back in Israel.
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      const hinted = sheetHint ? wb.SheetNames.filter((n) => n.includes(sheetHint)) : [];
      const guess = hinted.find((n) => n.includes("רשומות")) || hinted[0];
      const chosen = guess || wb.SheetNames[0];
      setSelectedSheet(chosen);
      parseSheet(wb, chosen);
    } catch (err) {
      setParseError("שגיאה בקריאת הקובץ. ודא שזהו קובץ אקסל (xlsx/xls) או CSV תקין.");
    }
  };

  const handleSheetChange = (e) => {
    const name = e.target.value;
    setSelectedSheet(name);
    if (workbook) parseSheet(workbook, name);
  };

  const handlePasteParse = () => {
    setParseError("");
    const lines = pasteText.split(/\r?\n/).filter((l) => l.trim() !== "");
    const aoa = lines.map((l) => l.split("\t"));
    processAOA(aoa);
  };

  const duplicateCount = parsedRows.filter((r) => r.duplicate).length;
  const toImport = skipDuplicates ? parsedRows.filter((r) => !r.duplicate) : parsedRows;

  const confirm = () => {
    if (toImport.length === 0) return;
    onConfirm(toImport.map(({ duplicate: _dup, ...r }) => r));
    setParsedRows([]);
    setPasteText("");
    setFileName("");
    setSkipped(0);
    setWorkbook(null);
    setSheetNames([]);
    setSelectedSheet("");
    setOpen(false);
  };

  return (
    <div className="thc-card thc-import" style={{ "--accent": colorAccent }}>
      <button className="thc-import-toggle" onClick={() => setOpen((o) => !o)}>
        <Upload size={16} />
        ייבוא רשימה מאקסל / CSV במקום הזנה ידנית
        <ChevronDown size={16} style={{ marginRight: "auto", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div className="thc-import-body">
          <p className="thc-import-hint">
            העמודות הצפויות (בכל סדר, לפי כותרות): <b>שם, מקצוע, שכבה, מספר כיתה, תאריך, שעות, סיבה, הערה</b>.
            אם יש שורת כותרת כללית מעל שורת העמודות (למשל "מורים"), המערכת תזהה ותדלג עליה אוטומטית.
            אם לא יזוהו כותרות בכלל, הייבוא יניח שזה בדיוק סדר העמודות. שמות/מקצועות/סיבות חדשים שלא קיימים ברשימות ב"הגדרות" יתווספו אליהן אוטומטית.
          </p>
          <div className="thc-seg" style={{ marginBottom: 12 }}>
            <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>העלאת קובץ</button>
            <button className={mode === "paste" ? "active" : ""} onClick={() => setMode("paste")}>הדבקה מאקסל</button>
          </div>

          {mode === "file" ? (
            <div className="thc-import-file">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
              {fileName && <span className="thc-muted">{fileName}</span>}
              {sheetNames.length > 1 && (
                <div className="thc-sheet-picker">
                  <span>גיליון בקובץ:</span>
                  <select value={selectedSheet} onChange={handleSheetChange}>
                    {sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="thc-import-paste">
              <textarea
                rows={6}
                placeholder="בגיליון האקסל: סמן טווח (כולל שורת כותרות אם יש), העתק (Ctrl+C), ואז הדבק כאן (Ctrl+V)"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <button className="thc-ghost-btn" onClick={handlePasteParse}>נתח נתונים</button>
            </div>
          )}

          {parseError && <p className="thc-error">{parseError}</p>}

          {parsedRows.length > 0 && (
            <div className="thc-import-preview">
              <p className="thc-muted">
                נמצאו <b>{parsedRows.length}</b> רשומות תקינות לייבוא
                {skipped > 0 && <> (וכן {skipped} שורות דולגו עקב חוסר בשם/תאריך/שעות)</>}. תצוגה מקדימה:
              </p>
              {duplicateCount > 0 && (
                <label className="thc-import-dup" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
                  {duplicateCount} רשומות כבר קיימות במערכת (או כפולות בקובץ) — לדלג עליהן
                </label>
              )}
              <div className="thc-table-wrap">
                <table className="thc-table">
                  <thead>
                    <tr><th>שם</th><th>מקצוע</th><th>שכבה</th><th>תאריך</th><th>שעות</th><th>סיבה</th></tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td>{r.name}</td><td>{r.subject}</td><td>{r.grade}</td><td>{r.date}</td><td className="thc-num">{r.hours}</td><td>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="thc-primary-btn" onClick={confirm} disabled={toImport.length === 0}>
                <Plus size={16} /> אשר ויבא {toImport.length} רשומות
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Entry form + table (shared by teachers / instructors)              */
/* ------------------------------------------------------------------ */

function EntryForm({ names, settings, reasonsList, onAdd, accent, existingEntries }) {
  const empty = { name: "", subject: "", grade: "", parallel: "", date: "", hours: "", reason: "", comment: "" };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [duplicateOf, setDuplicateOf] = useState(null);
  const [holidayWarning, setHolidayWarning] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const findDuplicate = (f) =>
    (existingEntries || []).find(
      (e) => e.name === f.name && e.date === f.date && e.subject === f.subject
    );

  const findHoliday = (dateStr, gradeVal) =>
    (settings.holidays || []).find(
      (h) => dateStr >= h.startDate && dateStr <= (h.endDate || h.startDate) && (!h.grade || h.grade === gradeVal)
    );

  const doAdd = (f) => {
    onAdd({ ...f, id: uid(), hours: Number(f.hours) });
    // Keep the name and date: several rows for the same person and day are usually entered together.
    setForm({ ...empty, name: f.name, date: f.date });
    setError("");
    setDuplicateOf(null);
    setHolidayWarning(null);
  };

  const checkDuplicateThenAdd = (f) => {
    const dup = findDuplicate(f);
    if (dup) {
      setDuplicateOf(dup);
      return;
    }
    doAdd(f);
  };

  const submit = () => {
    if (!form.name || !form.subject || !form.date || !form.hours) {
      setError("יש למלא שם, מקצוע, תאריך וכמות שעות");
      return;
    }
    if (!(Number(form.hours) > 0) || Number(form.hours) > 24) {
      setError("כמות השעות צריכה להיות מספר בין 1 ל-24");
      return;
    }
    setError("");
    const hol = findHoliday(form.date, form.grade);
    if (hol) {
      setHolidayWarning(hol);
      return;
    }
    checkDuplicateThenAdd(form);
  };

  return (
    <div className="thc-card thc-form" style={{ "--accent": accent }}>
      {holidayWarning && (
        <div className="thc-confirm-box thc-holiday-box">
          <p>
            <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> התאריך שבחרת ({form.date}) הוא <b>{holidayWarning.name}</b>
            {holidayWarning.grade ? <> (עבור שכבה {holidayWarning.grade})</> : ""}. להמשיך בכל זאת?
          </p>
          <div className="thc-confirm-actions">
            <button className="thc-primary-btn" onClick={() => { setHolidayWarning(null); checkDuplicateThenAdd(form); }}>כן, המשך בכל זאת</button>
            <button className="thc-ghost-btn" onClick={() => setHolidayWarning(null)}>ביטול, אני אבדוק</button>
          </div>
        </div>
      )}
      {duplicateOf && (
        <div className="thc-confirm-box thc-dup-box">
          <p>
            <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> נמצאה רשומה דומה: <b>{duplicateOf.name}</b>, {duplicateOf.subject}, בתאריך {duplicateOf.date} ({duplicateOf.hours} שעות, סיבה: {duplicateOf.reason || "—"}).
            ייתכן שזו הזנה כפולה בטעות.
          </p>
          <div className="thc-confirm-actions">
            <button className="thc-primary-btn" onClick={() => doAdd(form)}>הוסף בכל זאת</button>
            <button className="thc-ghost-btn" onClick={() => setDuplicateOf(null)}>ביטול, אני אבדוק</button>
          </div>
        </div>
      )}
      <div className="thc-form-grid">
        <Field label="שם">
          <NamePicker value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} options={names} label="שם" />
        </Field>
        <Field label="מקצוע">
          <select value={form.subject} onChange={set("subject")}>
            <option value="">בחר מקצוע...</option>
            {settings.subjects.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="שכבה">
          <select value={form.grade} onChange={set("grade")}>
            <option value="">בחר שכבה...</option>
            {settings.grades.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="מספר כיתה">
          <select value={form.parallel} onChange={set("parallel")}>
            <option value="">בחר...</option>
            {settings.parallels.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="תאריך">
          <input type="date" value={form.date} onChange={set("date")} />
        </Field>
        <Field label="יום בשבוע">
          <input value={dayOfWeekHebrew(form.date)} disabled placeholder="נגזר מהתאריך" />
        </Field>
        <Field label="חודש">
          <input value={monthHebrew(form.date)} disabled placeholder="נגזר מהתאריך" />
        </Field>
        <Field label="כמות שעות">
          <input type="number" min="1" step="1" value={form.hours} onChange={set("hours")} placeholder="לדוגמה: 2" />
        </Field>
        <Field label="סיבת ביטול">
          <select value={form.reason} onChange={set("reason")}>
            <option value="">בחר סיבה...</option>
            {reasonsList.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="הערה חופשית">
          <input value={form.comment} onChange={set("comment")} placeholder="אופציונלי" />
        </Field>
      </div>
      {error && <p className="thc-error">{error}</p>}
      <button className="thc-primary-btn" onClick={submit}>
        <Plus size={18} /> הוספת רשומה
      </button>
    </div>
  );
}

const PAGE_SIZE = 50;

function EntryTable({ entries, onDelete, onUpdate, onDeleteMany, canEdit, exportName, settings, namesList, reasonsList, onPickPerson }) {
  const [filterName, setFilterName] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterReason, setFilterReason] = useState("");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const months = useMemo(() => {
    const set = new Set(entries.map((e) => monthKey(e.date)).filter(Boolean));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries
      .filter((e) => (filterName ? e.name === filterName : true))
      .filter((e) => (filterMonth ? monthKey(e.date) === filterMonth : true))
      .filter((e) => (filterDay ? dayOfWeekHebrew(e.date) === filterDay : true))
      .filter((e) => (filterGrade ? e.grade === filterGrade : true))
      .filter((e) => (filterReason ? (e.reason || "") === filterReason : true))
      .filter((e) => {
        const q = searchKey(search);
        if (!q) return true;
        return searchKey([e.subject, e.reason, e.comment, e.grade, e.parallel, e.name].join(" ")).includes(q);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [entries, filterName, filterMonth, filterDay, filterGrade, filterReason, search]);

  useEffect(() => { setShown(PAGE_SIZE); }, [filterName, filterMonth, filterDay, filterGrade, filterReason, search]);

  const hoursByName = useMemo(() => {
    const map = {};
    entries.forEach((e) => { map[e.name] = (map[e.name] || 0) + Number(e.hours || 0); });
    return map;
  }, [entries]);
  const names = useMemo(() => Array.from(new Set(entries.map((e) => e.name))).sort((a, b) => a.localeCompare(b, "he")), [entries]);
  const nameMeta = useMemo(() => Object.fromEntries(names.map((n) => [n, `${fmt(hoursByName[n] || 0)} ש׳`])), [names, hoursByName]);
  const grades = useMemo(() => Array.from(new Set(entries.map((e) => e.grade).filter(Boolean))).sort(), [entries]);
  const reasons = useMemo(() => Array.from(new Set(entries.map((e) => e.reason || ""))).sort(), [entries]);
  const anyFilter = filterName || filterMonth || filterDay || filterGrade || filterReason || search;
  const totalHours = filtered.reduce((s, e) => s + Number(e.hours || 0), 0);

  const startEdit = (e) => { setEditingId(e.id); setEditDraft({ ...e }); };
  const cancelEdit = () => { setEditingId(null); setEditDraft(null); };
  const saveEdit = () => {
    if (!editDraft.name || !editDraft.subject || !editDraft.date || !(Number(editDraft.hours) > 0)) return;
    onUpdate(editingId, { ...editDraft, hours: Number(editDraft.hours) });
    setEditingId(null);
    setEditDraft(null);
  };
  const setDraftField = (k) => (ev) => setEditDraft((d) => ({ ...d, [k]: ev.target.value }));

  return (
    <div className="thc-card">
      <div className="thc-table-toolbar">
        <NamePicker value={filterName} onChange={setFilterName} options={names} emptyLabel="כל השמות" meta={nameMeta} label="סינון לפי שם" />
        <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
          <option value="">כל החודשים</option>
          {months.map((m) => <option key={m} value={m}>{monthKeyLabel(m)}</option>)}
        </select>
        <select value={filterDay} onChange={(e) => setFilterDay(e.target.value)}>
          <option value="">כל הימים</option>
          {DAY_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)} aria-label="שכבה">
          <option value="">כל השכבות</option>
          {grades.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={filterReason} onChange={(e) => setFilterReason(e.target.value)} aria-label="סיבה">
          <option value="">כל הסיבות</option>
          {reasons.map((r) => <option key={r} value={r}>{r || "לא צוינה"}</option>)}
        </select>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש במקצוע, סיבה, הערה…" aria-label="חיפוש חופשי" />
        {anyFilter && (
          <button className="thc-ghost-btn" onClick={() => { setFilterName(""); setFilterMonth(""); setFilterDay(""); setFilterGrade(""); setFilterReason(""); setSearch(""); }}>
            <X size={14} /> ניקוי סינון
          </button>
        )}
        <span className="thc-total-badge">{filtered.length} רשומות · סה"כ שעות: <b>{fmt(totalHours)}</b></span>
        <button className="thc-ghost-btn" onClick={() => exportCSV(filtered, exportName)}>
          <Download size={15} /> ייצוא ל-CSV
        </button>
        {canEdit && filtered.length > 0 && (
          <button className="thc-danger-btn" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> מחיקת רשומות
          </button>
        )}
      </div>

      {confirmDelete && (
        <div className="thc-confirm-box">
          <p>
            <b>למחוק {filtered.length} רשומות?</b> זו הפעולה שמוצגת כרגע לפי הסינון שנבחר (
            {filterName || "כל השמות"}, {filterMonth ? monthKeyLabel(filterMonth) : "כל החודשים"}, {filterDay || "כל הימים"}). הפעולה אינה הפיכה.
          </p>
          <div className="thc-confirm-actions">
            <button
              className="thc-danger-btn"
              onClick={() => { onDeleteMany(filtered.map((e) => e.id)); setConfirmDelete(false); }}
            >
              כן, מחק {filtered.length} רשומות
            </button>
            <button className="thc-ghost-btn" onClick={() => setConfirmDelete(false)}>ביטול</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="thc-empty">אין רשומות להצגה — נסה לשנות את הסינון או להוסיף רשומה חדשה.</p>
      ) : (
        <div className="thc-table-wrap">
          <table className="thc-table">
            <thead>
              <tr>
                <th>שם</th><th>מקצוע</th><th>שכבה</th><th>מספר כיתה</th><th>תאריך</th>
                <th>יום</th><th>חודש</th><th>שעות</th><th>סיבה</th><th>הערה</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, shown).map((e) => {
                const isEditing = canEdit && editingId === e.id;
                if (isEditing) {
                  return (
                    <tr key={e.id} className="thc-editing-row">
                      <td>
                        <select value={editDraft.name} onChange={setDraftField("name")}>
                          {namesList.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={editDraft.subject} onChange={setDraftField("subject")}>
                          {settings.subjects.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={editDraft.grade} onChange={setDraftField("grade")}>
                          <option value="">-</option>
                          {settings.grades.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={editDraft.parallel} onChange={setDraftField("parallel")}>
                          <option value="">-</option>
                          {settings.parallels.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td><input type="date" value={editDraft.date} onChange={setDraftField("date")} /></td>
                      <td><span className="thc-badge" style={dayBadgeStyle(dayOfWeekHebrew(editDraft.date))}>{dayOfWeekHebrew(editDraft.date)}</span></td>
                      <td><span className="thc-badge" style={monthBadgeStyle(editDraft.date)}>{monthHebrew(editDraft.date)}</span></td>
                      <td><input type="number" min="1" step="1" value={editDraft.hours} onChange={setDraftField("hours")} style={{ width: 60 }} /></td>
                      <td>
                        <select value={editDraft.reason} onChange={setDraftField("reason")}>
                          <option value="">-</option>
                          {reasonsList.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td><input value={editDraft.comment} onChange={setDraftField("comment")} style={{ minWidth: 120 }} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="thc-icon-btn thc-icon-save" onClick={saveEdit} aria-label="שמור"><Check size={15} /></button>
                          <button className="thc-icon-btn" onClick={cancelEdit} aria-label="בטל"><X size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={e.id}>
                    <td>{onPickPerson ? <button type="button" className="thc-link" onClick={() => onPickPerson(e.name)}>{e.name}</button> : e.name}</td>
                    <td>{e.subject}</td>
                    <td>{e.grade}</td>
                    <td>{e.parallel}</td>
                    <td>{e.date}</td>
                    <td><span className="thc-badge" style={dayBadgeStyle(dayOfWeekHebrew(e.date))}>{dayOfWeekHebrew(e.date)}</span></td>
                    <td><span className="thc-badge" style={monthBadgeStyle(e.date)}>{monthHebrew(e.date)}</span></td>
                    <td className="thc-num">{e.hours}</td>
                    <td>{e.reason}</td>
                    <td className="thc-comment">{e.comment}</td>
                    {canEdit && (
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="thc-icon-btn" onClick={() => startEdit(e)} aria-label="ערוך"><Pencil size={15} /></button>
                          <button className="thc-icon-btn" onClick={() => onDelete(e.id)} aria-label="מחק"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > shown && (
            <div className="thc-pager">
              <span className="thc-muted">מוצגות {shown} מתוך {filtered.length}</span>
              <button className="thc-ghost-btn" onClick={() => setShown((n) => n + PAGE_SIZE)}>הצג עוד {Math.min(PAGE_SIZE, filtered.length - shown)}</button>
              <button className="thc-ghost-btn" onClick={() => setShown(filtered.length)}>הצג הכל</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reports tab                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Summary tab                                                        */
/* ------------------------------------------------------------------ */

function exportSummaryCSV(rows, filename) {
  const headers = ["דירוג", "שם", "סה\"כ שעות", "רשומות", "היעדרות אחרונה", "הסיבה המובילה", "שעות בסיבה המובילה"];
  const esc = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  const body = rows.map((r, i) => [i + 1, r.name, r.hours, r.count, r.last, r.topReason, r.topReasonHours].map(esc).join(","));
  const blob = new Blob([`\uFEFF${headers.join(",")}\n${body.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SummaryTab({ teacherEntries, instructorEntries, alertThreshold, onPickPerson }) {
  const [dataset, setDataset] = useState("teachers");
  const [range, setRange] = useState({ from: "", to: "" });
  const [showAll, setShowAll] = useState(false);

  const source = dataset === "teachers" ? teacherEntries : instructorEntries;
  const ranked = useMemo(() => peopleOf(inRange(source, range.from, range.to)), [source, range]);

  const visibleRanked = showAll ? ranked : ranked.slice(0, 10);
  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);

  return (
    <div className="thc-card">
      <div className="thc-reports-toolbar">
        <div className="thc-seg">
          {[["teachers", "מורים"], ["instructors", "מדריכים"]].map(([v, l]) => (
            <button key={v} className={dataset === v ? "active" : ""} onClick={() => setDataset(v)}>{l}</button>
          ))}
        </div>
        <RangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        {ranked.length > 10 && (
          <button className="thc-ghost-btn" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "הצג רק 10 מובילים" : `הצג את כל ${ranked.length}`}
          </button>
        )}
        <button className="thc-ghost-btn" onClick={() => exportSummaryCSV(ranked, `סיכום-${dataset === "teachers" ? "מורים" : "מדריכים"}.csv`)}>
          <Download size={15} /> ייצוא ל-CSV
        </button>
      </div>

      {ranked.length === 0 ? (
        <p className="thc-empty">אין נתונים להצגה בטווח שנבחר.</p>
      ) : (
        <div className="thc-table-wrap">
          <table className="thc-table thc-ranking">
            <thead>
              <tr><th>#</th><th>שם</th><th>סה"כ שעות שאבדו</th><th>התראה</th><th>הסיבה המובילה</th></tr>
            </thead>
            <tbody>
              {visibleRanked.map((r, i) => (
                <tr key={r.name} className={i < 3 ? "thc-top" : ""}>
                  <td>{medal(i)}</td>
                  <td>
                    {r.hours >= alertThreshold && <Flag size={14} className="thc-name-flag" />}
                    <button type="button" className="thc-link" onClick={() => onPickPerson(r.name, dataset)}>{r.name}</button>
                  </td>
                  <td className="thc-num"><b>{fmt(r.hours)}</b></td>
                  <td>
                    {r.hours >= alertThreshold && (
                      <span className="thc-alert-badge" title={`חצה את סף ${alertThreshold} השעות`}>
                        <AlertTriangle size={13} /> מעל הסף
                      </span>
                    )}
                  </td>
                  <td className="thc-top-reason">
                    <span className="thc-badge thc-reason-badge">{r.topReason}</span>
                    <span className="thc-num thc-reason-fraction">{r.topReasonHours} מתוך {r.hours}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings tab                                                       */
/* ------------------------------------------------------------------ */

function hebrewNumeralFromYear(yearNum) {
  const num = yearNum % 1000; // מתעלמים מהאלפים (5786 -> 786)
  const hundredsMap = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];
  const tensMap = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const onesMap = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const h = Math.floor(num / 100);
  let rem = num % 100;
  let letters = hundredsMap[h] || "";
  if (rem === 15) letters += "טו"; // חריגים דתיים מקובלים (נמנעים מי"ה/י"ו)
  else if (rem === 16) letters += "טז";
  else letters += (tensMap[Math.floor(rem / 10)] || "") + (onesMap[rem % 10] || "");
  if (letters.length === 0) return "";
  if (letters.length === 1) return letters + "׳";
  return letters.slice(0, -1) + "״" + letters.slice(-1);
}

function hebrewYearForDate(date) {
  try {
    const fmt = new Intl.DateTimeFormat("he-u-ca-hebrew", { year: "numeric" });
    const parts = fmt.formatToParts(date);
    const yearPart = parts.find((p) => p.type === "year");
    if (!yearPart) return "";
    const raw = yearPart.value;
    if (/^\d+$/.test(raw)) return hebrewNumeralFromYear(parseInt(raw, 10));
    return raw; // כבר בפורמט אותיות עבריות בסביבות עם נתוני ICU מלאים
  } catch (e) {
    return "";
  }
}

function suggestSchoolYearLabel() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const startYear = m >= 8 ? y : y - 1;
  const gregLabel = `${startYear}–${startYear + 1}`;
  const heb = hebrewYearForDate(new Date(startYear, 9, 15)); // אמצע אוקטובר — בוודאות אחרי ראש השנה
  return heb ? `${heb} (${gregLabel})` : `שנת הלימודים ${gregLabel}`;
}

function ArchiveTab({ teacherEntries, instructorEntries, archives, onCreate, onDelete, onExport }) {
  const [label, setLabel] = useState(suggestSchoolYearLabel());
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const currentTotal = teacherEntries.length + instructorEntries.length;
  const currentHours = [...teacherEntries, ...instructorEntries].reduce((s, e) => s + Number(e.hours || 0), 0);

  const doCreate = () => {
    if (!label.trim()) return;
    onCreate(label.trim());
    setConfirmCreate(false);
    setLabel(suggestSchoolYearLabel());
  };

  return (
    <div>
      <div className="thc-card">
        <h3>יצירת ארכיון לשנת לימודים</h3>
        <p className="thc-import-hint" style={{ marginBottom: 14 }}>
          פעולה זו שומרת "תמונת מצב" של כל הנתונים הנוכחיים (מורים ומדריכים) תחת שם ארכיון, כדי שתוכל לעיין בהם גם בעתיד.
          <b> זו אינה פעולת מחיקה</b> - הנתונים הנוכחיים יישארו במקומם גם אחרי היצירה. אם תרצה להתחיל שנה חדשה בטבלאות ריקות,
          תעבור לאחר מכן ל"הזנת מורים" / "הזנת מדריכים" ותשתמש בכפתור "מחיקת רשומות" שם (אחרי שוידאת שהארכיון נשמר בהצלחה).
        </p>
        <div className="thc-holiday-form">
          <Field label="שם הארכיון">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='לדוגמה: שנת הלימודים 2025–2026' />
          </Field>
          <button className="thc-primary-btn thc-holiday-add-btn" onClick={() => setConfirmCreate(true)} disabled={currentTotal === 0}>
            <ArchiveIcon size={16} /> שמור ארכיון מהנתונים הנוכחיים
          </button>
        </div>
        {currentTotal === 0 && <p className="thc-muted" style={{ marginTop: 10 }}>אין כרגע נתונים במערכת לארכוב.</p>}

        {confirmCreate && (
          <div className="thc-confirm-box thc-holiday-box" style={{ marginTop: 16 }}>
            <p>
              ליצור ארכיון "<b>{label}</b>" עם {currentTotal} רשומות (סה"כ {currentHours} שעות)? הנתונים הנוכחיים יישארו כפי שהם, זה רק שומר עותק נוסף.
            </p>
            <div className="thc-confirm-actions">
              <button className="thc-primary-btn" onClick={doCreate}>כן, שמור ארכיון</button>
              <button className="thc-ghost-btn" onClick={() => setConfirmCreate(false)}>ביטול</button>
            </div>
          </div>
        )}
      </div>

      <div className="thc-card">
        <h3>ארכיונים שמורים</h3>
        {archives.length === 0 ? (
          <p className="thc-empty">אין עדיין ארכיונים שמורים.</p>
        ) : (
          <div className="thc-archive-list">
            {archives.slice().reverse().map((a) => {
              const total = a.teacherEntries.length + a.instructorEntries.length;
              const hours = [...a.teacherEntries, ...a.instructorEntries].reduce((s, e) => s + Number(e.hours || 0), 0);
              const dateStr = new Date(a.createdAt).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
              return (
                <div key={a.id} className="thc-archive-row">
                  <div className="thc-archive-info">
                    <span className="thc-archive-label"><ArchiveIcon size={15} /> {a.label}</span>
                    <span className="thc-archive-meta">{total} רשומות · {hours} שעות · נשמר בתאריך {dateStr}</span>
                  </div>
                  <div className="thc-archive-actions">
                    <button className="thc-ghost-btn" onClick={() => onExport(a)}>
                      <Download size={14} /> ייצוא לאקסל
                    </button>
                    <button className="thc-icon-btn" onClick={() => setConfirmDeleteId(a.id)} aria-label="מחק ארכיון">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {confirmDeleteId === a.id && (
                    <div className="thc-confirm-box" style={{ marginTop: 10, width: "100%" }}>
                      <p>למחוק לצמיתות את הארכיון "<b>{a.label}</b>"? פעולה זו אינה הפיכה.</p>
                      <div className="thc-confirm-actions">
                        <button className="thc-danger-btn" onClick={() => { onDelete(a.id); setConfirmDeleteId(null); }}>כן, מחק ארכיון</button>
                        <button className="thc-ghost-btn" onClick={() => setConfirmDeleteId(null)}>ביטול</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsTab({ settings, onChange, onRenamePerson, teacherEntries, instructorEntries }) {
  const upd = (key) => (val) => onChange({ ...settings, [key]: val });
  const countOf = (entries) => (name) => entries.filter((e) => e.name === name).length;
  return (
    <>
    <p className="thc-import-hint">
      גררו פריט כדי לשנות את הסדר שלו בתוך הרשימה. בשמות מורים ומדריכים, העיפרון מאפשר לשנות שם, והשינוי יחול גם על כל הרשומות הקיימות.
    </p>
    <div className="thc-settings-grid">
      <ListEditor
        title="שמות מורים"
        items={settings.teacherNames}
        onChange={upd("teacherNames")}
        onRename={(from, to) => onRenamePerson("teachers", from, to)}
        countRecords={countOf(teacherEntries)}
      />
      <ListEditor
        title="שמות מדריכים"
        items={settings.instructorNames}
        onChange={upd("instructorNames")}
        onRename={(from, to) => onRenamePerson("instructors", from, to)}
        countRecords={countOf(instructorEntries)}
      />
      <ListEditor title="מקצועות" items={settings.subjects} onChange={upd("subjects")} />
      <ListEditor title="שכבות" items={settings.grades} onChange={upd("grades")} />
      <ListEditor title="סיבות ביטול — מורים" items={settings.teacherReasons} onChange={upd("teacherReasons")} />
      <ListEditor title="סיבות ביטול — מדריכים" items={settings.instructorReasons} onChange={upd("instructorReasons")} />
      <ListEditor title="מספרי כיתה" items={settings.parallels} onChange={upd("parallels")} />
      <div className="thc-list-editor">
        <h4>סף התראה (שעות)</h4>
        <p className="thc-import-hint" style={{ marginBottom: 10 }}>
          מורה/מדריך שחצה כמות שעות זו (בטווח שנבחר בסיכום השנתי) יסומן אוטומטית באזהרה.
        </p>
        <input
          type="number"
          min="1"
          step="1"
          value={settings.alertThreshold}
          onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n >= 1) upd("alertThreshold")(n); }}
          style={{ width: 100, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontFamily: "Assistant, sans-serif", fontSize: 14 }}
        />
      </div>
    </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */

const ALL_TABS = [
  { id: "overview", label: "סקירה כללית", icon: LayoutDashboard, color: "#D99A2B" },
  { id: "teachers", label: "הזנת מורים", icon: Users, color: "#1B2A4A" },
  { id: "instructors", label: "הזנת מדריכים", icon: GraduationCap, color: "#2E6DA4" },
  { id: "reports", label: "דוחות וגרפים", icon: BarChart3, color: "#E8821E" },
  { id: "people", label: "לפי איש צוות", icon: UserSearch, color: "#2E6DA4" },
  { id: "summary", label: "סיכום שנתי", icon: Trophy, color: "#C96A1E" },
  { id: "holidays", label: "חגים ומועדים", icon: CalendarDays, color: "#6B4A9E" },
  { id: "archive", label: "ארכיון", icon: ArchiveIcon, color: "#6E5A3E" },
  { id: "settings", label: "הגדרות", icon: SettingsIcon, color: "#3A4750" },
];

const MANAGER_TABS = ["overview", "reports", "people", "summary"];
const POLL_MS = 20000;

export default function App() {
  const [role, setRole] = useState("coordinator"); // coordinator | manager
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [teacherEntries, setTeacherEntries] = useState([]);
  const [instructorEntries, setInstructorEntries] = useState([]);
  const [lastExportAt, setLastExportAt] = useState(null);
  const [backingUp, setBackingUp] = useState(false);
  const [archives, setArchives] = useState([]);
  const [personFocus, setPersonFocus] = useState(null);
  const [undo, setUndo] = useState(null);

  const visibleTabs = role === "manager" ? ALL_TABS.filter((t) => MANAGER_TABS.includes(t.id)) : ALL_TABS;
  const [activeTab, setActiveTab] = useState("overview");

  // Server state bookkeeping: the last version seen, writes in flight, the settings last saved.
  const versionRef = useRef(null);
  const pendingRef = useRef(0);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const undoTimer = useRef(null);

  useEffect(() => {
    if (role === "manager" && !MANAGER_TABS.includes(activeTab)) setActiveTab("overview");
  }, [role]); // eslint-disable-line

  useEffect(() => {
    document.title = 'דו"ח איבוד שעות - טכני באר שבע';
  }, []);

  const applyState = useCallback((st) => {
    const merged = { ...DEFAULT_SETTINGS, ...(st.settings || {}) };
    settingsRef.current = merged;
    setSettings(merged);
    setTeacherEntries(st.teachers || []);
    setInstructorEntries(st.instructors || []);
    setArchives(st.archives || []);
    setLastExportAt(st.lastExportAt ?? null);
    versionRef.current = st.version;
  }, []);

  const reload = useCallback(async () => {
    try {
      applyState(await fetchState());
    } catch (e) {
      console.error("reload failed", e);
    }
  }, [applyState]);

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 1) => {
      try {
        const st = await fetchState();
        if (cancelled) return;
        applyState(st);
        setLoadError("");
        setLoading(false);
      } catch (e) {
        console.error(`load failed (attempt ${attempt})`, e);
        if (cancelled) return;
        if (e && e.retriable && attempt < 15) {
          setLoadError(`השרת מתאתחל... (ניסיון ${attempt})`);
          setTimeout(() => { if (!cancelled) load(attempt + 1); }, 2000);
          return;
        }
        const detail = e && e.message ? ` (${e.message})` : "";
        setLoadError(`לא ניתן להתחבר לשרת${detail}. בדוק שהשרת פועל, ואז לחץ נסה שוב.`);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [applyState]);

  // Picks up changes made by others (another coordinator, another tab) while the page is open.
  useEffect(() => {
    if (loading) return undefined;
    const tick = async () => {
      if (document.visibilityState !== "visible" || pendingRef.current > 0) return;
      try {
        const v = await fetchVersion();
        if (v !== versionRef.current && pendingRef.current === 0) await reload();
      } catch { /* offline: try again next tick */ }
    };
    const timer = setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [loading, reload]);

  /** Runs a server write; on failure the page reloads the server's state so nothing shown is unsaved. */
  const write = useCallback(async (fn) => {
    pendingRef.current += 1;
    try {
      const res = await fn();
      if (res && res.version) versionRef.current = res.version;
      setSaveError("");
      return res;
    } catch (e) {
      console.error("save failed", e);
      setSaveError(e.status === 400 || e.status === 409 ? `לא נשמר: ${e.message}` : "שמירת הנתונים לשרת נכשלה. בדקו את החיבור ונסו שוב.");
      await reload();
      return null;
    } finally {
      pendingRef.current -= 1;
    }
  }, [reload]);

  const setterFor = (kind) => (kind === "teachers" ? setTeacherEntries : setInstructorEntries);

  const addEntries = useCallback((kind, entries) => {
    setterFor(kind)((prev) => [...prev, ...entries]);
    write(() => entryOps(kind, { add: entries }));
  }, [write]); // eslint-disable-line

  const updateEntry = useCallback((kind, id, updated) => {
    setterFor(kind)((prev) => prev.map((e) => (e.id === id ? { ...e, ...updated, id } : e)));
    write(() => entryOps(kind, { update: [{ ...updated, id }] }));
  }, [write]); // eslint-disable-line

  const removeEntries = useCallback((kind, ids) => {
    const idSet = new Set(ids);
    const list = kind === "teachers" ? teacherEntries : instructorEntries;
    const removed = list.filter((e) => idSet.has(e.id));
    setterFor(kind)((prev) => prev.filter((e) => !idSet.has(e.id)));
    write(() => entryOps(kind, { remove: ids }));
    clearTimeout(undoTimer.current);
    setUndo({ kind, entries: removed });
    undoTimer.current = setTimeout(() => setUndo(null), 10000);
  }, [write, teacherEntries, instructorEntries]); // eslint-disable-line

  const undoRemove = useCallback(() => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    addEntries(undo.kind, undo.entries);
    setUndo(null);
  }, [undo, addEntries]);

  /** Saves only the settings keys that changed, so two people editing different lists don't clash. */
  const updateSettings = useCallback((nextOrFn) => {
    const prev = settingsRef.current;
    const next = typeof nextOrFn === "function" ? nextOrFn(prev) : nextOrFn;
    const patch = {};
    for (const k of Object.keys(next)) if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) patch[k] = next[k];
    settingsRef.current = next;
    setSettings(next);
    if (Object.keys(patch).length) write(() => patchSettings(patch));
  }, [write]);

  /** Renames on the server, then reloads, because the name changes in both the list and the records. */
  const handleRenamePerson = useCallback(async (kind, from, to) => {
    const res = await write(() => renamePerson(kind, from, to));
    if (res) await reload();
    return res;
  }, [write, reload]);

  const handleCreateArchive = useCallback((label) => {
    const snapshot = {
      id: uid(),
      label,
      createdAt: Date.now(),
      teacherEntries: JSON.parse(JSON.stringify(teacherEntries)),
      instructorEntries: JSON.parse(JSON.stringify(instructorEntries)),
    };
    setArchives((prev) => [...prev, snapshot]);
    write(() => archiveOps({ add: [snapshot] }));
  }, [teacherEntries, instructorEntries, write]);

  const handleDeleteArchive = useCallback((id) => {
    setArchives((prev) => prev.filter((a) => a.id !== id));
    write(() => archiveOps({ remove: [id] }));
  }, [write]);

  /** Builds a report file; the button shows progress, and failures appear in the error banner. */
  const runBackup = useCallback(async (report) => {
    setBackingUp(true);
    try {
      await downloadBackup({ alertThreshold: settings.alertThreshold, ...report });
      return true;
    } catch (e) {
      console.error("backup failed", e);
      setSaveError("יצירת קובץ הגיבוי נכשלה. נסו שוב.");
      return false;
    } finally {
      setBackingUp(false);
    }
  }, [settings.alertThreshold]);

  const handleExportBackup = useCallback(async () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const done = await runBackup({ teacherEntries, instructorEntries, filename: `גיבוי-שעות-איבוד-${stamp}.xlsx` });
    if (!done) return;
    setLastExportAt(now.getTime());
    write(() => saveLastExport(now.getTime()));
  }, [teacherEntries, instructorEntries, runBackup, write]);

  const handleExportArchive = useCallback((archive) => runBackup({
    teacherEntries: archive.teacherEntries,
    instructorEntries: archive.instructorEntries,
    label: `ארכיון: ${archive.label}`,
    filename: `ארכיון-${archive.label}.xlsx`,
  }), [runBackup]);

  const importEntries = useCallback((kind, rows) => {
    addEntries(kind, rows.map((r) => ({ ...r, id: uid() })));
    updateSettings((prev) => {
      const nameKey = kind === "teachers" ? "teacherNames" : "instructorNames";
      const reasonKey = kind === "teachers" ? "teacherReasons" : "instructorReasons";
      const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
      return {
        ...prev,
        [nameKey]: uniq([...prev[nameKey], ...rows.map((r) => r.name)]),
        subjects: uniq([...prev.subjects, ...rows.map((r) => r.subject)]),
        grades: uniq([...prev.grades, ...rows.map((r) => r.grade)]),
        [reasonKey]: uniq([...prev[reasonKey], ...rows.map((r) => r.reason)]),
        parallels: uniq([...prev.parallels, ...rows.map((r) => r.parallel)]),
      };
    });
  }, [addEntries, updateSettings]);

  /** Opens a person's profile; `kind` is guessed from the lists when not given. */
  const pickPerson = useCallback((name, kind) => {
    const k = kind
      || (teacherEntries.some((e) => e.name === name) || settings.teacherNames.includes(name) ? "teachers" : "instructors");
    setPersonFocus({ kind: k, name, at: Date.now() });
    setActiveTab("people");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [teacherEntries, settings.teacherNames]);

  return (
    <div className="thc-root" dir="rtl">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&family=Assistant:wght@400;500;600;700&family=Roboto+Mono:wght@500;700&display=swap');

        .thc-root {
          --bg: #EEF2F7;
          --paper: #FFFFFF;
          --ink: #1B2A4A;
          --ink-soft: #57678A;
          --teal: #1B2A4A;
          --teal-dark: #101A30;
          --blue: #2E6DA4;
          --skyblue: #5FA8DC;
          --gold: #E8821E;
          --line: #DCE3ED;
          font-family: 'Assistant', sans-serif;
          background: var(--bg);
          color: var(--ink);
          min-height: 100%;
          padding: 0;
          box-sizing: border-box;
        }
        .thc-root *, .thc-root *::before, .thc-root *::after { box-sizing: border-box; }

        .thc-header {
          background-color: var(--teal);
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          color: #F3F0E6;
          padding: 22px 28px;
          border-radius: 0 0 18px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 14px;
          position: relative;
          overflow: hidden;
        }
        .thc-header::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(13,20,38,0.62) 0%, rgba(13,20,38,0.42) 55%, rgba(13,20,38,0.58) 100%);
          pointer-events: none;
        }
        .thc-header h1 {
          font-family: 'Frank Ruhl Libre', serif;
          font-weight: 900;
          font-size: 34px;
          margin: 0;
          letter-spacing: 0.2px;
        }
        .thc-header p { margin: 4px 0 0; font-size: 13px; color: #C7D3E8; }
        .thc-credit { opacity: 0.55; font-size: 11.5px !important; margin-top: 2px !important; }

        .thc-header-brand { display: flex; align-items: center; gap: 18px; z-index: 1; position: relative; }
        .thc-logo {
          width: 98px;
          height: 98px;
          object-fit: contain;
          flex-shrink: 0;
          filter: drop-shadow(0 8px 14px rgba(0,0,0,0.4));
          margin-bottom: -10px;
        }

        .thc-role-switch {
          display: flex;
          background: rgba(255,255,255,0.1);
          border-radius: 999px;
          padding: 3px;
          gap: 2px;
          z-index: 1;
        }
        .thc-role-switch button {
          border: none;
          background: transparent;
          color: #E4E9E2;
          padding: 8px 16px;
          border-radius: 999px;
          font-family: 'Assistant', sans-serif;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all .15s ease;
        }
        .thc-role-switch button.active { background: var(--gold); color: #241C05; }

        .thc-tabs {
          display: flex;
          gap: 6px;
          padding: 30px 24px 0;
          overflow-x: auto;
        }
        .thc-tab {
          border: none;
          background: transparent;
          padding: 12px 18px 14px;
          font-family: 'Assistant', sans-serif;
          font-weight: 600;
          font-size: 14px;
          color: var(--ink-soft);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 3px solid transparent;
          white-space: nowrap;
          position: relative;
          top: 1px;
        }
        .thc-tab.active {
          color: var(--tab-color, var(--teal));
          border-bottom: 3px solid var(--tab-color, var(--teal));
        }
        .thc-tab:hover:not(.active) { color: var(--ink); }

        .thc-body { padding: 20px 24px 40px; max-width: 1180px; margin: 0 auto; }

        .thc-card {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 20px 22px;
          margin-bottom: 18px;
          position: relative;
        }
        .thc-card::before {
          content: '';
          position: absolute;
          top: 14px; bottom: 14px; right: 0;
          width: 3px;
          background: #E8821E40;
          border-radius: 2px;
        }
        .thc-card h3 {
          font-family: 'Frank Ruhl Libre', serif;
          font-size: 17px;
          margin: 0 0 14px;
          color: var(--teal);
        }

        .thc-form { border-top: 4px solid var(--accent, var(--teal)); }
        .thc-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px 14px;
        }
        .thc-field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--ink-soft); font-weight: 600; }
        .thc-field select, .thc-field input {
          font-family: 'Assistant', sans-serif;
          font-size: 14px;
          padding: 9px 10px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #FBFAF7;
          color: var(--ink);
        }
        .thc-field select:focus, .thc-field input:focus { outline: 2px solid var(--teal); outline-offset: 1px; }
        .thc-field input:disabled { color: #97A19B; background: #F1F2EF; }

        .thc-error { color: #A6432B; font-size: 13px; margin: 12px 0 0; font-weight: 600; }

        .thc-primary-btn {
          margin-top: 16px;
          background: var(--teal);
          color: #F3F0E6;
          border: none;
          padding: 11px 20px;
          border-radius: 9px;
          font-family: 'Assistant', sans-serif;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .thc-primary-btn:hover { background: var(--teal-dark); }

        .thc-ghost-btn {
          background: transparent;
          border: 1px solid var(--line);
          color: var(--ink-soft);
          padding: 8px 14px;
          border-radius: 8px;
          font-family: 'Assistant', sans-serif;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .thc-ghost-btn:hover { border-color: var(--teal); color: var(--teal); }

        .thc-danger-btn {
          background: #C0392B;
          border: none;
          color: #FFFFFF;
          padding: 8px 14px;
          border-radius: 8px;
          font-family: 'Assistant', sans-serif;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .thc-danger-btn:hover { background: #A22E22; }

        .thc-confirm-box {
          background: #FDEDEB;
          border: 1px solid #E8A79C;
          border-radius: 10px;
          padding: 14px 16px;
          margin-bottom: 16px;
        }
        .thc-confirm-box p { margin: 0 0 12px; font-size: 13.5px; color: #7A2E22; line-height: 1.6; }
        .thc-confirm-actions { display: flex; gap: 10px; }
        .thc-dup-box { background: #FFF6E0; border-color: #E8C168; margin-bottom: 16px; }
        .thc-dup-box p { color: #7A5A10; }
        .thc-holiday-box { background: #EEF2FB; border-color: #B7C6EA; margin-bottom: 16px; }
        .thc-holiday-box p { color: #2E3D7A; }

        .thc-backup-banner-danger { background: #FDEDEB; border-color: #E8A79C; margin-bottom: 18px; }
        .thc-backup-banner-danger p { color: #7A2E22; }
        .thc-stat-card-danger { border-top-color: #C0392B; background: #FFFAF9; }
        .thc-stat-card-danger .thc-stat-value-sm { color: #A6432B; }
        .thc-name-flag { color: #C0392B; vertical-align: -2px; margin-left: 5px; }

        .thc-overview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 14px;
        }
        .thc-stat-card {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          border-top: 4px solid var(--gold);
        }
        .thc-stat-label {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--ink-soft);
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .thc-stat-value {
          font-family: 'Roboto Mono', monospace;
          font-size: 30px;
          font-weight: 700;
          color: var(--teal);
        }
        .thc-stat-value-sm {
          font-size: 17px;
          font-weight: 700;
          color: var(--ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .thc-stat-sub {
          font-family: 'Roboto Mono', monospace;
          font-size: 13px;
          color: var(--gold);
          font-weight: 700;
        }

        .thc-icon-btn {
          background: transparent;
          border: none;
          color: #A6432B;
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: inline-flex;
        }
        .thc-icon-btn:hover { background: #A6432B15; }

        .thc-table-toolbar {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .thc-table-toolbar select {
          font-family: 'Assistant', sans-serif;
          padding: 8px 10px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #FBFAF7;
          font-size: 13px;
        }
        .thc-total-badge {
          margin-right: auto;
          font-size: 13px;
          color: var(--ink-soft);
          background: #F1F2EF;
          padding: 7px 12px;
          border-radius: 999px;
        }
        .thc-total-badge b { font-family: 'Roboto Mono', monospace; color: var(--teal); }

        .thc-table-wrap { overflow-x: auto; }
        .thc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .thc-table thead th {
          text-align: right;
          font-family: 'Assistant', sans-serif;
          font-weight: 700;
          color: var(--ink-soft);
          border-bottom: 2px solid var(--line);
          padding: 8px 10px;
          white-space: nowrap;
        }
        .thc-table tbody td { padding: 9px 10px; border-bottom: 1px solid #EEEFEA; white-space: nowrap; }
        .thc-table tbody tr:nth-child(even) { background: #FAFAF7; }
        .thc-table .thc-num { font-family: 'Roboto Mono', monospace; font-weight: 600; }
        .thc-badge {
          display: inline-block;
          padding: 3px 11px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }
        .thc-editing-row { background: #FFF9E8 !important; }
        .thc-editing-row td { padding: 6px 8px; }
        .thc-editing-row select, .thc-editing-row input {
          font-family: 'Assistant', sans-serif;
          font-size: 12.5px;
          padding: 6px 7px;
          border: 1px solid var(--gold);
          border-radius: 6px;
          background: #FFFFFF;
        }
        .thc-icon-save { color: var(--teal); }
        .thc-icon-save:hover { background: #1B2A4A22; }
        .thc-comment { white-space: normal; min-width: 140px; color: var(--ink-soft); }

        .thc-ranking tbody tr.thc-top td { font-weight: 700; background: #FFF1E0; }
        .thc-top-reason { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
        .thc-reason-badge { background: #EEF2F7; color: var(--ink); font-weight: 600; }
        .thc-reason-fraction { font-size: 11.5px; color: var(--ink-soft); font-weight: 500 !important; }
        .thc-alert-badge {
          display: inline-flex; align-items: center; gap: 4px;
          background: #FDECEA; color: #A6432B; border: 1px solid #F0BDB4;
          padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; white-space: nowrap;
        }
        .thc-ranking td:first-child { font-size: 16px; text-align: center; width: 40px; }

        .thc-empty { color: var(--ink-soft); font-size: 14px; text-align: center; padding: 24px 0; }
        .thc-muted { color: #97A19B; font-size: 13px; }

        .thc-reports-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
        .thc-seg { display: flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
        .thc-seg button {
          border: none; background: var(--paper); padding: 8px 16px; font-family: 'Assistant', sans-serif;
          font-weight: 600; font-size: 13px; cursor: pointer; color: var(--ink-soft);
          border-left: 1px solid var(--line);
        }
        .thc-seg button:last-child { border-left: none; }
        .thc-seg button.active { background: var(--teal); color: #F3F0E6; }
        .thc-reports-row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        @media (max-width: 760px) { .thc-reports-row { grid-template-columns: 1fr; } }
        .thc-pie-with-legend { display: flex; flex-direction: column; align-items: center; }
        .thc-legend {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px 16px;
          margin-top: 6px;
          max-width: 100%;
        }
        .thc-legend-item { display: flex; align-items: center; gap: 6px; }
        .thc-legend-swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
        .thc-legend-label { font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; }

        .thc-barlist { display: flex; flex-direction: column; gap: 10px; }
        .thc-subject-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .thc-subject-header h3 { margin: 0; }
        .thc-barlist-row { display: flex; align-items: center; gap: 12px; }
        .thc-barlist-label {
          width: 150px;
          flex-shrink: 0;
          font-size: 13.5px;
          font-weight: 600;
          color: var(--ink);
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .thc-barlist-track {
          flex: 1;
          background: #F1F2EF;
          border-radius: 7px;
          height: 24px;
          overflow: hidden;
          position: relative;
        }
        .thc-barlist-fill {
          height: 100%;
          background: linear-gradient(90deg, #E8821E, #F5A64A);
          border-radius: 7px;
          transition: width 0.3s ease;
        }
        .thc-barlist-value {
          width: 55px;
          flex-shrink: 0;
          font-family: 'Roboto Mono', monospace;
          font-weight: 700;
          font-size: 13px;
          color: var(--ink);
          text-align: left;
        }

        .thc-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        @media (max-width: 760px) { .thc-settings-grid { grid-template-columns: 1fr; } }
        .thc-list-editor {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 16px 18px;
        }
        .thc-list-editor h4 { font-family: 'Frank Ruhl Libre', serif; margin: 0 0 10px; color: var(--teal); font-size: 15px; }
        .thc-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; min-height: 26px; }
        .thc-chip {
          background: #F1F2EF; border: 1px solid var(--line); border-radius: 999px;
          padding: 5px 6px 5px 10px; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px;
        }
        .thc-chip-x { border: none; background: #E1E4DE; border-radius: 50%; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--ink-soft); }
        .thc-chip-x:hover { background: #A6432B33; color: #A6432B; }
        .thc-add-row { display: flex; gap: 8px; }
        .thc-add-row input {
          flex: 1; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-family: 'Assistant', sans-serif; font-size: 13px;
        }
        .thc-add-row button {
          border: none; background: var(--teal); color: #F3F0E6; border-radius: 8px; padding: 0 14px;
          font-weight: 700; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
        }
        .thc-holiday-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; min-height: 26px; }
        .thc-holiday-row {
          display: flex; align-items: center; gap: 10px; background: #F1F2EF; border: 1px solid var(--line);
          border-radius: 8px; padding: 6px 10px; font-size: 13px;
        }
        .thc-holiday-date { font-family: 'Roboto Mono', monospace; color: var(--ink-soft); flex-shrink: 0; }
        .thc-holiday-name { flex: 1; font-weight: 600; color: var(--ink); }
        .thc-holiday-grade-tag {
          font-size: 11.5px; font-weight: 700; color: var(--blue); background: #E9F1FB;
          border: 1px solid #B7CDE8; border-radius: 999px; padding: 2px 9px; flex-shrink: 0;
        }
        .thc-holiday-form {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 14px;
        }
        .thc-holiday-form .thc-field { min-width: 170px; flex: 1; }
        .thc-holiday-add-btn { margin-top: 0; height: 41px; }
        .thc-holiday-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .thc-archive-list { display: flex; flex-direction: column; gap: 10px; }
        .thc-archive-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          background: #F8F7F3;
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 12px 16px;
        }
        .thc-archive-info { display: flex; flex-direction: column; gap: 3px; }
        .thc-archive-label { display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--ink); font-size: 14.5px; }
        .thc-archive-meta { font-size: 12px; color: var(--ink-soft); }
        .thc-archive-actions { display: flex; align-items: center; gap: 8px; }

        .thc-import { border-top: 4px dashed var(--accent, var(--teal)); }
        .thc-import-toggle {
          width: 100%;
          background: transparent;
          border: none;
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: 'Assistant', sans-serif;
          font-weight: 700;
          font-size: 14.5px;
          color: var(--accent, var(--teal));
          cursor: pointer;
          padding: 2px 0;
        }
        .thc-import-body { margin-top: 16px; }
        .thc-import-hint { font-size: 12.5px; color: var(--ink-soft); margin: 0 0 14px; line-height: 1.6; }
        .thc-import-file input[type="file"] {
          font-family: 'Assistant', sans-serif; font-size: 13px;
        }
        .thc-sheet-picker {
          display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: var(--ink-soft);
        }
        .thc-sheet-picker select {
          font-family: 'Assistant', sans-serif; padding: 6px 9px; border: 1px solid var(--line); border-radius: 7px; background: #FBFAF7;
        }
        .thc-import-paste textarea {
          width: 100%;
          font-family: 'Roboto Mono', monospace;
          font-size: 12.5px;
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 10px;
          resize: vertical;
          margin-bottom: 10px;
          direction: rtl;
        }
        .thc-import-preview { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 14px; }

        .thc-loading { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 80px 0; color: var(--ink-soft); }
        .thc-spin { animation: thc-spin 1s linear infinite; }
        @keyframes thc-spin { to { transform: rotate(360deg); } }
        .thc-storage-banner {
          margin: 12px 22px 0;
          padding: 10px 14px;
          border-radius: 8px;
          background: #FDECEC;
          color: #8A2E2E;
          font-size: 13.5px;
          line-height: 1.5;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
      `}</style>

      <div className="thc-header" style={{ backgroundImage: `url(${SKY_BANNER_URI})` }}>
        <div className="thc-header-brand">
          <img src={LOGO_DATA_URI} alt="לוגו" className="thc-logo" />
          <div>
            <h1>דו"ח איבוד שעות - טכני באר שבע</h1>
            <p>מעקב, דוחות וסיכומים לצוות ולהנהלה</p>
            <p className="thc-credit">פותח ע"י צוות תפעול הדרכה</p>
          </div>
        </div>
        <div className="thc-header-actions">
          <button
            type="button"
            className="thc-backup-btn"
            onClick={handleExportBackup}
            disabled={loading || backingUp || teacherEntries.length + instructorEntries.length === 0}
            title={lastExportAt ? `גיבוי אחרון: ${new Date(lastExportAt).toLocaleDateString("he-IL")}` : "עדיין לא נוצר גיבוי"}
          >
            {backingUp ? <Loader2 className="thc-spin" size={16} /> : <DatabaseBackup size={16} />}
            {backingUp ? "מכין גיבוי..." : "גיבוי ודוח לאקסל"}
          </button>
          <div className="thc-role-switch">
            <button className={role === "coordinator" ? "active" : ""} onClick={() => setRole("coordinator")}>
              <Pencil size={14} /> רכז/ת מערכת
            </button>
            <button className={role === "manager" ? "active" : ""} onClick={() => setRole("manager")}>
              <Eye size={14} /> מנהל/ת (צפייה)
            </button>
          </div>
        </div>
      </div>

      {(loadError || saveError) && (
        <div className="thc-storage-banner" role="alert">
          <span>{loadError || saveError}</span>
          <button className="thc-ghost-btn" onClick={() => window.location.reload()}>נסה שוב</button>
        </div>
      )}

      <div className="thc-tabs">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`thc-tab ${activeTab === t.id ? "active" : ""}`}
              style={{ "--tab-color": t.color }}
              onClick={() => setActiveTab(t.id)}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="thc-body">
        {loading ? (
          <div className="thc-loading"><Loader2 className="thc-spin" size={22} /> טוען נתונים...</div>
        ) : (
          <>
            {activeTab === "overview" && (
              <OverviewTab
                teacherEntries={teacherEntries}
                instructorEntries={instructorEntries}
                lastExportAt={lastExportAt}
                onExportBackup={handleExportBackup}
                alertThreshold={settings.alertThreshold}
                onPickPerson={pickPerson}
              />
            )}
            {activeTab === "teachers" && (
              <>
                <ImportPanel colorAccent="#1B2A4A" sheetHint="מור" onConfirm={(rows) => importEntries("teachers", rows)} existingEntries={teacherEntries} />
                <EntryForm names={settings.teacherNames} settings={settings} reasonsList={settings.teacherReasons} onAdd={(entry) => addEntries("teachers", [entry])} accent="#1B2A4A" existingEntries={teacherEntries} />
                <EntryTable
                  entries={teacherEntries}
                  onDelete={(id) => removeEntries("teachers", [id])}
                  onUpdate={(id, updated) => updateEntry("teachers", id, updated)}
                  onDeleteMany={(ids) => removeEntries("teachers", ids)}
                  onPickPerson={(name) => pickPerson(name, "teachers")}
                  canEdit
                  exportName="שעות-מורים.csv"
                  settings={settings}
                  namesList={settings.teacherNames}
                  reasonsList={settings.teacherReasons}
                />
              </>
            )}
            {activeTab === "instructors" && (
              <>
                <ImportPanel colorAccent="#2E6DA4" sheetHint="מדריכ" onConfirm={(rows) => importEntries("instructors", rows)} existingEntries={instructorEntries} />
                <EntryForm names={settings.instructorNames} settings={settings} reasonsList={settings.instructorReasons} onAdd={(entry) => addEntries("instructors", [entry])} accent="#2E6DA4" existingEntries={instructorEntries} />
                <EntryTable
                  entries={instructorEntries}
                  onDelete={(id) => removeEntries("instructors", [id])}
                  onUpdate={(id, updated) => updateEntry("instructors", id, updated)}
                  onDeleteMany={(ids) => removeEntries("instructors", ids)}
                  onPickPerson={(name) => pickPerson(name, "instructors")}
                  canEdit
                  exportName="שעות-מדריכים.csv"
                  settings={settings}
                  namesList={settings.instructorNames}
                  reasonsList={settings.instructorReasons}
                />
              </>
            )}
            {activeTab === "reports" && (
              <ReportsTab teacherEntries={teacherEntries} instructorEntries={instructorEntries} settings={settings} onPickPerson={(name) => pickPerson(name)} />
            )}
            {activeTab === "people" && (
              <PeopleTab teacherEntries={teacherEntries} instructorEntries={instructorEntries} settings={settings} focus={personFocus} alertThreshold={settings.alertThreshold} />
            )}
            {activeTab === "summary" && (
              <SummaryTab teacherEntries={teacherEntries} instructorEntries={instructorEntries} alertThreshold={settings.alertThreshold} onPickPerson={pickPerson} />
            )}
            {activeTab === "holidays" && role === "coordinator" && (
              <HolidaysTab holidays={settings.holidays} onChange={(next) => updateSettings({ ...settings, holidays: next })} grades={settings.grades} />
            )}
            {activeTab === "archive" && role === "coordinator" && (
              <ArchiveTab
                teacherEntries={teacherEntries}
                instructorEntries={instructorEntries}
                archives={archives}
                onCreate={handleCreateArchive}
                onDelete={handleDeleteArchive}
                onExport={handleExportArchive}
              />
            )}
            {activeTab === "settings" && role === "coordinator" && (
              <SettingsTab
                settings={settings}
                onChange={updateSettings}
                onRenamePerson={handleRenamePerson}
                teacherEntries={teacherEntries}
                instructorEntries={instructorEntries}
              />
            )}
          </>
        )}
      </div>

      {undo && (
        <div className="thc-undo" role="status">
          <span>{undo.entries.length === 1 ? "הרשומה נמחקה" : `${undo.entries.length} רשומות נמחקו`}</span>
          <button type="button" onClick={undoRemove}>ביטול המחיקה</button>
        </div>
      )}
    </div>
  );
}
