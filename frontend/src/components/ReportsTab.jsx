import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarList, Kpi, RangeBar, axisTick, numTick, tooltipStyle } from "./ui.jsx";
import {
  byClass, byWeekday, fmt, groupHours, inRange, monthKey, monthKeyLabel, monthsSpan, people, pct, previousPeriod, sumHours,
} from "../lib/stats.js";

/** Teachers / instructors keep their color in every chart (validated pair, always with a legend). */
export const SERIES = { teachers: { label: "מורים", color: "#2E6DA4" }, instructors: { label: "מדריכים", color: "#E8821E" } };
const NAVY = "#1B2A4A";

function Delta({ now, before }) {
  if (before == null) return null;
  if (before === 0) return now > 0 ? <>אין נתונים בתקופה הקודמת</> : null;
  const change = ((now - before) / before) * 100;
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "■";
  return <>{arrow} {Math.abs(change).toFixed(0)}% לעומת התקופה הקודמת ({fmt(before)})</>;
}

export default function ReportsTab({ teacherEntries, instructorEntries, settings, onPickPerson }) {
  const [dataset, setDataset] = useState("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [valueMode, setValueMode] = useState("hours");

  const pick = (kind) => (dataset === "all" || dataset === kind);
  const tagged = useMemo(() => [
    ...(pick("teachers") ? teacherEntries.map((e) => ({ ...e, kind: "teachers" })) : []),
    ...(pick("instructors") ? instructorEntries.map((e) => ({ ...e, kind: "instructors" })) : []),
  ], [teacherEntries, instructorEntries, dataset]); // eslint-disable-line

  const source = useMemo(() => inRange(tagged, range.from, range.to), [tagged, range]);
  const prev = previousPeriod(range.from, range.to);
  const prevHours = prev ? sumHours(inRange(tagged, prev.from, prev.to)) : null;

  const total = sumHours(source);
  const ranked = useMemo(() => people(source), [source]);
  const rosterSize = (pick("teachers") ? settings.teacherNames.length : 0) + (pick("instructors") ? settings.instructorNames.length : 0);
  const weekdays = useMemo(() => byWeekday(source), [source]);
  const worstDay = [...weekdays].sort((a, b) => b.value - a.value)[0];

  const monthly = useMemo(() => monthsSpan(source).map((k) => {
    const inMonth = source.filter((e) => monthKey(e.date) === k);
    return {
      month: monthKeyLabel(k),
      teachers: sumHours(inMonth.filter((e) => e.kind === "teachers")),
      instructors: sumHours(inMonth.filter((e) => e.kind === "instructors")),
      hours: sumHours(inMonth),
    };
  }), [source]);

  const reasonsAll = useMemo(() => groupHours(source, (e) => e.reason), [source]);
  const grades = useMemo(() => groupHours(source, (e) => e.grade), [source]);
  const subjects = useMemo(() => groupHours(source, (e) => e.subject), [source]);
  const classes = useMemo(() => byClass(source).filter((c) => c.name !== "לא צוין"), [source]);

  const toolbar = (
    <div className="thc-card thc-filters">
      <div className="thc-seg">
        {[["all", "הכל"], ["teachers", "מורים"], ["instructors", "מדריכים"]].map(([v, l]) => (
          <button key={v} className={dataset === v ? "active" : ""} onClick={() => setDataset(v)}>{l}</button>
        ))}
      </div>
      <RangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
    </div>
  );

  if (source.length === 0) {
    return (
      <div className="thc-reports">
        {toolbar}
        <div className="thc-card"><p className="thc-empty">אין נתונים לבחירה הזו. נסו טווח תאריכים אחר או אוכלוסייה אחרת.</p></div>
      </div>
    );
  }

  return (
    <div className="thc-reports">
      {toolbar}

      <div className="thc-overview-grid thc-kpis">
        <Kpi label="שעות שאבדו" value={fmt(total)} sub={<Delta now={total} before={prevHours} />} />
        <Kpi label="רשומות" value={source.length} sub={`ממוצע ${fmt(total / source.length)} שעות לרשומה`} />
        <Kpi label="אנשי צוות עם היעדרות" value={ranked.length} sub={rosterSize ? `מתוך ${rosterSize} ברשימות (${pct(ranked.length, rosterSize)})` : null} />
        <Kpi label="ממוצע לאיש צוות" value={fmt(total / Math.max(ranked.length, 1))} sub={ranked[0] ? `הגבוה: ${ranked[0].name} (${fmt(ranked[0].hours)})` : null} />
        <Kpi label="היום עם הכי הרבה שעות" value={<span className="thc-kpi-text">{worstDay?.value ? worstDay.name : "—"}</span>} sub={worstDay?.value ? `${fmt(worstDay.value)} שעות (${pct(worstDay.value, total)})` : null} />
      </div>

      <div className="thc-card">
        <h3>שעות שאבדו לפי חודש</h3>
        <ResponsiveContainer width="100%" height={290}>
          <BarChart data={monthly} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EE" vertical={false} />
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: "#D8DDD6" }} />
            <YAxis tick={numTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(27,42,74,0.06)" }} formatter={(v, n) => [`${fmt(v)} שעות`, n]} />
            {dataset === "all" ? (
              <>
                <Legend wrapperStyle={{ fontFamily: "Assistant", fontWeight: 600 }} />
                <Bar isAnimationActive={false} dataKey="teachers" name={SERIES.teachers.label} stackId="a" fill={SERIES.teachers.color} stroke="#fff" strokeWidth={1} />
                <Bar isAnimationActive={false} dataKey="instructors" name={SERIES.instructors.label} stackId="a" fill={SERIES.instructors.color} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
              </>
            ) : (
              <Bar isAnimationActive={false} dataKey="hours" name="שעות" fill={NAVY} radius={[4, 4, 0, 0]} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="thc-reports-row">
        <div className="thc-card">
          <h3>פילוח לפי סיבת ביטול</h3>
          <BarList rows={reasonsAll} total={total} limit={8} mode="percent" />
        </div>

        <div className="thc-card">
          <h3>שעות שאבדו לפי יום בשבוע</h3>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={weekdays} margin={{ top: 18, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EE" vertical={false} />
              <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: "#D8DDD6" }} />
              <YAxis tick={numTick} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(27,42,74,0.06)" }}
                formatter={(v, _n, item) => [`${fmt(v)} שעות · ${item.payload.count} רשומות (${pct(v, total)})`, "שעות"]} />
              <Bar isAnimationActive={false} dataKey="value" name="שעות" fill={NAVY} radius={[4, 4, 0, 0]} label={{ position: "top", fontFamily: "Roboto Mono", fontSize: 11, fill: "#3A4750" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="thc-reports-row">
        <div className="thc-card">
          <h3>הכיתות שאיבדו הכי הרבה שעות</h3>
          <BarList rows={classes} total={total} limit={8} fill="linear-gradient(90deg, #2E6DA4, #5FA8DC)" />
        </div>
        <div className="thc-card">
          <h3>פילוח לפי שכבה</h3>
          <BarList rows={grades} total={total} limit={8} mode="percent" fill="linear-gradient(90deg, #3C5A78, #8FBEE0)" />
        </div>
      </div>

      <div className="thc-card">
        <div className="thc-subject-header">
          <h3>אנשי הצוות עם הכי הרבה שעות שאבדו</h3>
          <span className="thc-muted">לחיצה על שם פותחת את הכרטיס האישי</span>
        </div>
        <BarList rows={ranked.map((p) => ({ name: p.name, value: p.hours, count: p.count }))} total={total} limit={10} onPick={onPickPerson} fill={`linear-gradient(90deg, ${NAVY}, #3C5A78)`} />
      </div>

      <div className="thc-card">
        <div className="thc-subject-header">
          <h3>שעות שאבדו לפי מקצוע</h3>
          <div className="thc-seg">
            <button className={valueMode === "hours" ? "active" : ""} onClick={() => setValueMode("hours")}>מספרים</button>
            <button className={valueMode === "percent" ? "active" : ""} onClick={() => setValueMode("percent")}>אחוזים</button>
          </div>
        </div>
        <BarList rows={subjects} total={total} limit={10} mode={valueMode} />
      </div>
    </div>
  );
}
