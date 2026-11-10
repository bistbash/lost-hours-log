import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CalendarRange, DatabaseBackup, Download, X } from "lucide-react";
import { fmt, inRange, monthKey, monthKeyLabel, sumHours } from "../lib/stats.js";

const dateText = (s) => (s ? s.split("-").reverse().join("/") : "");
const lastDayOf = (key) => {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

const MODES = [
  { id: "all", label: "כל הרשומות", hint: "גיבוי מלא של המערכת", Icon: DatabaseBackup },
  { id: "month", label: "חודש מסוים", hint: "דוח לחודש אחד", Icon: CalendarDays },
  { id: "range", label: "טווח תאריכים", hint: "מתאריך עד תאריך", Icon: CalendarRange },
];

/**
 * Asks what goes into the Excel file before it is built: everything, one month, or a date range.
 * onConfirm({ from, to, period, scope }) gets empty dates for everything.
 */
export default function BackupDialog({ teacherEntries, instructorEntries, onConfirm, onClose }) {
  const all = useMemo(() => [...teacherEntries, ...instructorEntries], [teacherEntries, instructorEntries]);
  const months = useMemo(
    () => [...new Set(all.map((e) => monthKey(e.date)).filter(Boolean))].sort().reverse(),
    [all],
  );
  const [mode, setMode] = useState("all");
  const [month, setMonth] = useState(months[0] || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let range = { from: "", to: "" };
  if (mode === "month" && month) range = { from: `${month}-01`, to: lastDayOf(month) };
  if (mode === "range") range = { from, to };
  const rangeMissing = mode === "range" && !from && !to;

  const teachers = mode === "all" ? teacherEntries : inRange(teacherEntries, range.from, range.to);
  const instructors = mode === "all" ? instructorEntries : inRange(instructorEntries, range.from, range.to);
  const count = teachers.length + instructors.length;
  const hours = sumHours(teachers) + sumHours(instructors);

  let period = "";
  if (mode === "month" && month) period = monthKeyLabel(month).replace(" '", " 20");
  if (mode === "range" && !rangeMissing) {
    period = from && to ? `${dateText(from)} - ${dateText(to)}` : from ? `מ-${dateText(from)}` : `עד ${dateText(to)}`;
  }

  const submit = () => {
    if (count === 0 || rangeMissing) return;
    onConfirm({ ...range, period, scope: mode, teacherEntries: teachers, instructorEntries: instructors });
  };

  return (
    <div className="thc-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="thc-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-dialog-title" tabIndex={-1} ref={dialogRef}>
        <header className="thc-dialog-head">
          <h3 id="backup-dialog-title">גיבוי ודוח לאקסל</h3>
          <button type="button" className="thc-dialog-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button>
        </header>
        <p className="thc-dialog-sub">מה להכניס לקובץ?</p>

        <div className="thc-backup-modes" role="radiogroup" aria-label="היקף הדוח">
          {MODES.map(({ id, label, hint, Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              className={`thc-backup-mode ${mode === id ? "is-active" : ""}`}
              onClick={() => setMode(id)}
            >
              <Icon size={20} />
              <b>{label}</b>
              <small>{hint}</small>
            </button>
          ))}
        </div>

        {mode === "month" && (
          <label className="thc-dialog-field">
            <span>חודש</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((k) => <option key={k} value={k}>{monthKeyLabel(k).replace(" '", " 20")}</option>)}
            </select>
          </label>
        )}
        {mode === "range" && (
          <div className="thc-dialog-dates">
            <label className="thc-dialog-field">
              <span>מתאריך</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="thc-dialog-field">
              <span>עד תאריך</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}

        <p className={`thc-dialog-summary ${count === 0 && !rangeMissing ? "is-empty" : ""}`} role="status">
          {rangeMissing
            ? "בחרו תאריך התחלה, תאריך סיום או את שניהם."
            : count === 0
              ? "אין רשומות בתקופה שנבחרה."
              : <>ייכנסו לקובץ <b>{count === 1 ? "רשומה אחת" : `${count} רשומות`}</b> ({`מורים: ${teachers.length}, מדריכים: ${instructors.length}`}), <b>{hours === 1 ? "שעה אחת" : `${fmt(hours)} שעות`}</b>.</>}
        </p>
        {mode !== "all" && <p className="thc-dialog-note">דוח חלקי לא נחשב גיבוי מלא, ולכן לא מעדכן את תאריך הגיבוי האחרון.</p>}

        <footer className="thc-dialog-actions">
          <button type="button" className="thc-ghost-btn" onClick={onClose}>ביטול</button>
          <button type="button" className="thc-primary-btn" onClick={submit} disabled={count === 0 || rangeMissing}>
            <Download size={16} /> הורדת הקובץ
          </button>
        </footer>
      </div>
    </div>
  );
}
