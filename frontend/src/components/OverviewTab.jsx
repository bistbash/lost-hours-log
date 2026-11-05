import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CloudDownload, Download } from "lucide-react";
import { BarList, Kpi, axisTick, numTick, tooltipStyle } from "./ui.jsx";
import { SERIES } from "./ReportsTab.jsx";
import { byWeekday, fmt, groupHours, monthKey, monthKeyLabel, monthsSpan, people, pct, sumHours } from "../lib/stats.js";

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Dashboard: this month vs. last month, the trend, who and why, and the backup reminder. */
export default function OverviewTab({ teacherEntries, instructorEntries, lastExportAt, onExportBackup, alertThreshold, onPickPerson }) {
  const tagged = useMemo(() => [
    ...teacherEntries.map((e) => ({ ...e, kind: "teachers" })),
    ...instructorEntries.map((e) => ({ ...e, kind: "instructors" })),
  ], [teacherEntries, instructorEntries]);

  const now = new Date();
  const thisMonth = ym(now);
  const lastMonth = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const hoursThisMonth = sumHours(tagged.filter((e) => monthKey(e.date) === thisMonth));
  const hoursLastMonth = sumHours(tagged.filter((e) => monthKey(e.date) === lastMonth));
  const total = sumHours(tagged);

  const teachers = useMemo(() => people(teacherEntries), [teacherEntries]);
  const instructors = useMemo(() => people(instructorEntries), [instructorEntries]);
  const overThreshold = [...teachers, ...instructors].filter((p) => p.hours >= alertThreshold).length;
  const reasons = useMemo(() => groupHours(tagged, (e) => e.reason), [tagged]);

  // The last six months with data, teachers and instructors stacked.
  const monthly = useMemo(() => monthsSpan(tagged).slice(-6).map((k) => {
    const inMonth = tagged.filter((e) => monthKey(e.date) === k);
    return {
      month: monthKeyLabel(k),
      teachers: sumHours(inMonth.filter((e) => e.kind === "teachers")),
      instructors: sumHours(inMonth.filter((e) => e.kind === "instructors")),
    };
  }), [tagged]);

  const daysSinceExport = lastExportAt ? Math.floor((Date.now() - lastExportAt) / 86400000) : null;
  const needsBackup = tagged.length > 0 && (daysSinceExport === null || daysSinceExport >= 30);
  const lastExportDateStr = lastExportAt
    ? new Date(lastExportAt).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  if (tagged.length === 0) {
    return (
      <div className="thc-card thc-empty-state">
        <h3>עדיין אין נתונים</h3>
        <p>התחילו בהזנת שעות בלשונית "הזנת מורים" או "הזנת מדריכים", או ייבאו קובץ אקסל.</p>
      </div>
    );
  }

  const monthDelta = hoursLastMonth
    ? `${hoursThisMonth >= hoursLastMonth ? "▲" : "▼"} ${Math.abs(((hoursThisMonth - hoursLastMonth) / hoursLastMonth) * 100).toFixed(0)}% לעומת החודש הקודם (${fmt(hoursLastMonth)})`
    : "אין נתונים לחודש הקודם";

  return (
    <div className="thc-overview">
      {needsBackup && (
        <div className="thc-banner thc-banner-warn" role="status">
          <CloudDownload size={18} aria-hidden="true" />
          <span>
            {lastExportAt
              ? <>הגיבוי האחרון לאקסל היה ב-<b>{lastExportDateStr}</b> (לפני {daysSinceExport} ימים).</>
              : "עדיין לא יוצא גיבוי לאקסל."}{" "}
            (המערכת שומרת גם עותק יומי אוטומטי בשרת.)
          </span>
          <button className="thc-primary-btn thc-btn-sm" onClick={onExportBackup}><Download size={15} /> ייצוא גיבוי</button>
        </div>
      )}

      <div className="thc-overview-grid thc-kpis">
        <Kpi label="שעות שאבדו החודש" value={fmt(hoursThisMonth)} sub={monthDelta} />
        <Kpi label='סה"כ שעות שאבדו' value={fmt(total)} sub={`${tagged.length} רשומות`} />
        <Kpi label="אנשי צוות עם היעדרות" value={teachers.length + instructors.length} sub={`${teachers.length} מורים · ${instructors.length} מדריכים · ממוצע ${fmt(total / Math.max(teachers.length + instructors.length, 1))} שעות`} />
        <Kpi label={`מעל סף ${alertThreshold} שעות`} value={overThreshold} sub={overThreshold ? "מסומנים בדגל אדום" : "אף אחד עדיין"} danger={overThreshold > 0} />
        <Kpi label="הסיבה הנפוצה" value={<span className="thc-kpi-text">{reasons[0]?.name || "—"}</span>} sub={reasons[0] ? `${fmt(reasons[0].value)} שעות (${pct(reasons[0].value, total)})` : null} />
      </div>

      <div className="thc-overview-main">
        <div className="thc-card">
          <h3>מגמה חודשית</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthly} margin={{ top: 10, right: 6, left: -14, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EE" vertical={false} />
              <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: "#D8DDD6" }} />
              <YAxis tick={numTick} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(27,42,74,0.06)" }} formatter={(v, n) => [`${fmt(v)} שעות`, n]} />
              <Legend wrapperStyle={{ fontFamily: "Assistant", fontWeight: 600 }} />
              <Bar isAnimationActive={false} dataKey="teachers" name={SERIES.teachers.label} stackId="a" fill={SERIES.teachers.color} stroke="#fff" strokeWidth={1} />
              <Bar isAnimationActive={false} dataKey="instructors" name={SERIES.instructors.label} stackId="a" fill={SERIES.instructors.color} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="thc-card">
          <h3>סיבות מובילות</h3>
          <BarList rows={reasons} total={total} limit={6} mode="percent" />
        </div>
      </div>

      <BusiestDay entries={tagged} />

      <div className="thc-reports-row">
        <TopPeople title="מורים עם הכי הרבה שעות" rows={teachers} kind="teachers" alertThreshold={alertThreshold} onPickPerson={onPickPerson} />
        <TopPeople title="מדריכים עם הכי הרבה שעות" rows={instructors} kind="instructors" alertThreshold={alertThreshold} onPickPerson={onPickPerson} />
      </div>

      {!needsBackup && lastExportDateStr && (
        <p className="thc-muted thc-backup-note">
          גיבוי אחרון לאקסל: {lastExportDateStr}{" "}
          <button type="button" className="thc-link" onClick={onExportBackup}>ייצוא גיבוי חדש</button>
        </p>
      )}
    </div>
  );
}

/** Which weekday loses the most hours, for all reasons or for one. */
function BusiestDay({ entries }) {
  const [reason, setReason] = useState("");
  const reasons = useMemo(() => groupHours(entries, (e) => e.reason), [entries]);
  const current = reasons.some((r) => r.name === reason) ? reason : ""; // The chosen reason may have been removed.
  const filtered = useMemo(
    () => (current ? entries.filter((e) => (e.reason || "לא צוין") === current) : entries),
    [entries, current],
  );
  const days = useMemo(() => byWeekday(filtered), [filtered]);
  const total = sumHours(filtered);
  const peak = Math.max(0, ...days.map((d) => d.value));
  const busiest = days.filter((d) => peak > 0 && d.value === peak);

  return (
    <div className="thc-card">
      <div className="thc-subject-header">
        <h3>היום עם הכי הרבה ביטולים</h3>
        <label className="thc-day-filter">
          סיבה
          <select value={current} onChange={(e) => setReason(e.target.value)}>
            <option value="">כל הסיבות</option>
            {reasons.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </label>
      </div>
      <div className="thc-day-layout">
        <div className="thc-day-headline">
          <strong>{busiest.length ? `${busiest.length > 1 ? "ימים" : "יום"} ${busiest.map((d) => d.name).join(", ")}` : "—"}</strong>
          {busiest.length > 0 && <span>{peak === 1 ? "שעה אחת" : `${fmt(peak)} שעות`}{busiest.length > 1 ? " בכל יום" : ""}, {pct(peak, total)} מהשעות{current ? ` בסיבה "${current}"` : ""}</span>}
        </div>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={days} margin={{ top: 20, right: 8, left: 8, bottom: 0 }} barCategoryGap="30%">
            <XAxis dataKey="name" reversed tick={axisTick} tickLine={false} axisLine={{ stroke: "#D8DDD6" }} />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: "rgba(27,42,74,0.06)" }}
              formatter={(v, _n, item) => [`${fmt(v)} שעות · ${item.payload.count} רשומות (${pct(v, total)})`, "שעות"]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="value"
              name="שעות"
              maxBarSize={64}
              radius={[4, 4, 0, 0]}
              label={{ position: "top", formatter: (v) => (v ? fmt(v) : ""), fontFamily: "Roboto Mono", fontSize: 12, fill: "#3A4750" }}
            >
              {days.map((d) => <Cell key={d.name} fill={peak > 0 && d.value === peak ? "#E8821E" : "#B4C7DA"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TopPeople({ title, rows, kind, alertThreshold, onPickPerson }) {
  return (
    <div className="thc-card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="thc-empty">אין נתונים.</p>
      ) : (
        <ol className="thc-top-list">
          {rows.slice(0, 5).map((p, i) => (
            <li key={p.name}>
              <span className="thc-top-rank">{i + 1}</span>
              <button type="button" className="thc-link thc-top-name" onClick={() => onPickPerson(p.name, kind)}>
                {p.hours >= alertThreshold && <AlertTriangle size={13} className="thc-name-flag" aria-label="מעל הסף" />}
                {p.name}
              </button>
              <span className="thc-toplist-reason">{p.topReason}</span>
              <span className="thc-top-hours">{fmt(p.hours)} <small>שעות</small></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
