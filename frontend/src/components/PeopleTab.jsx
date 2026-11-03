import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Download, Search, X } from "lucide-react";
import { BarList, Kpi, RangeBar, axisTick, numTick, tooltipStyle } from "./ui.jsx";
import {
  DAY_NAMES, byClass, byWeekday, fmt, groupHours, inRange, matchNames, monthKey, monthKeyLabel, monthsSpan, people, pct, searchKey, sumHours,
} from "../lib/stats.js";

const NAVY = "#1B2A4A";
const AVG_COLOR = "#E8821E";

function exportPersonCSV(name, entries) {
  const headers = ["שם", "מקצוע", "שכבה", "מספר כיתה", "תאריך", "יום", "שעות", "סיבה", "הערה"];
  const esc = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  const rows = entries.map((e) => [e.name, e.subject, e.grade, e.parallel, e.date, DAY_NAMES[new Date(`${e.date}T00:00:00`).getDay()] || "", e.hours, e.reason, e.comment].map(esc).join(","));
  const blob = new Blob([`﻿${headers.join(",")}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One person at a time: a searchable, alphabetically indexed list of every teacher / instructor (including
 * those with no lost hours), and the selected person's profile compared with the rest of the staff.
 */
export default function PeopleTab({ teacherEntries, instructorEntries, settings, focus, alertThreshold }) {
  const [kind, setKind] = useState(focus?.kind || "teachers");
  const [selected, setSelected] = useState(focus?.name || "");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("hours");
  const [range, setRange] = useState({ from: "", to: "" });
  const listRef = useRef(null);

  useEffect(() => {
    if (!focus?.name) return;
    setKind(focus.kind);
    setSelected(focus.name);
    setQuery("");
  }, [focus]);

  const all = kind === "teachers" ? teacherEntries : instructorEntries;
  const roster = kind === "teachers" ? settings.teacherNames : settings.instructorNames;
  const scoped = useMemo(() => inRange(all, range.from, range.to), [all, range]);
  const ranked = useMemo(() => people(scoped), [scoped]);
  const totalScoped = sumHours(scoped);

  // Everyone on the roster or with entries; people with no lost hours are listed too.
  const rows = useMemo(() => {
    const byName = new Map(ranked.map((p, i) => [p.name, { ...p, rank: i + 1 }]));
    for (const n of roster) if (!byName.has(n)) byName.set(n, { name: n, hours: 0, count: 0, last: "", rank: null });
    const list = [...byName.values()];
    const names = matchNames(list.map((p) => p.name), query);
    const order = new Map(names.map((n, i) => [n, i]));
    const filtered = list.filter((p) => order.has(p.name));
    if (query) return filtered.sort((a, b) => order.get(a.name) - order.get(b.name));
    return sort === "hours"
      ? filtered.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, "he"))
      : filtered.sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [ranked, roster, query, sort]);

  const letters = useMemo(() => {
    const set = new Set(rows.map((p) => searchKey(p.name)[0]).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [rows]);

  /** Scrolls only the list (never the page) so `el` sits at its top, or just into view. */
  const scrollList = (el, mode) => {
    const list = listRef.current;
    if (!list || !el) return;
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (mode === "start") list.scrollTo({ top, behavior: "smooth" });
    else if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTo({ top: top - list.clientHeight / 3 });
  };

  const jumpTo = (letter) => {
    setSort("name");
    setQuery("");
    requestAnimationFrame(() => {
      scrollList(listRef.current?.querySelector(`[data-letter="${letter}"]`), "start");
    });
  };

  // Keep the selected person in view when the list changes (e.g. after arriving from another tab).
  useEffect(() => {
    if (!selected || !listRef.current) return;
    scrollList(listRef.current.querySelector(`[data-name="${CSS.escape(selected)}"]`), "nearest");
  }, [selected, kind]); // eslint-disable-line

  const firstOfLetter = new Set();
  const seenLetter = new Set();
  if (sort === "name" && !query) {
    for (const p of rows) {
      const l = searchKey(p.name)[0];
      if (!seenLetter.has(l)) { seenLetter.add(l); firstOfLetter.add(p.name); }
    }
  }

  return (
    <div className="thc-people">
      <div className="thc-card thc-filters">
        <div className="thc-seg">
          {[["teachers", "מורים"], ["instructors", "מדריכים"]].map(([v, l]) => (
            <button key={v} className={kind === v ? "active" : ""} onClick={() => { setKind(v); setSelected(""); setQuery(""); }}>{l}</button>
          ))}
        </div>
        <RangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </div>

      <div className="thc-people-layout">
        <aside className="thc-card thc-people-list">
          <div className="thc-people-search">
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש לפי שם פרטי או משפחה…" aria-label="חיפוש איש צוות"
              onKeyDown={(e) => { if (e.key === "Enter" && rows[0]) setSelected(rows[0].name); }} />
            {query && <button type="button" className="thc-picker-clear" aria-label="ניקוי" onClick={() => setQuery("")}><X size={13} /></button>}
          </div>
          <div className="thc-people-sort">
            <span className="thc-muted">{rows.length} {kind === "teachers" ? "מורים" : "מדריכים"}</span>
            <div className="thc-seg thc-seg-sm">
              <button className={sort === "hours" ? "active" : ""} onClick={() => setSort("hours")}>לפי שעות</button>
              <button className={sort === "name" ? "active" : ""} onClick={() => setSort("name")}>א-ב</button>
            </div>
          </div>
          <nav className="thc-alpha" aria-label="קפיצה לאות">
            {letters.map((l) => <button key={l} type="button" onClick={() => jumpTo(l)}>{l}</button>)}
          </nav>
          <ul className="thc-people-items" ref={listRef}>
            {rows.length === 0 && <li className="thc-muted" style={{ padding: 12 }}>לא נמצא שם שמתאים לחיפוש.</li>}
            {rows.map((p) => (
              <li key={p.name} data-name={p.name} data-letter={firstOfLetter.has(p.name) ? searchKey(p.name)[0] : undefined}>
                {firstOfLetter.has(p.name) && <div className="thc-alpha-head">{searchKey(p.name)[0]}</div>}
                <button type="button" className={`thc-person-row${selected === p.name ? " is-selected" : ""}${p.hours ? "" : " is-zero"}`} onClick={() => setSelected(p.name)}>
                  <span className="thc-person-name">
                    {p.hours >= alertThreshold && <AlertTriangle size={13} className="thc-name-flag" aria-label="מעל סף ההתראה" />}
                    {p.name}
                  </span>
                  <span className="thc-person-hours">{p.hours ? fmt(p.hours) : "—"}</span>
                  <span className="thc-person-bar" style={{ width: `${ranked[0] ? (p.hours / ranked[0].hours) * 100 : 0}%` }} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="thc-people-profile">
          {selected ? (
            <Profile name={selected} all={all} scoped={scoped} ranked={ranked} totalScoped={totalScoped} alertThreshold={alertThreshold} kindLabel={kind === "teachers" ? "המורים" : "המדריכים"} />
          ) : (
            <div className="thc-card"><p className="thc-empty">בחרו איש צוות מהרשימה (אפשר להקליד שם, או לקפוץ לאות) כדי לראות את הכרטיס האישי.</p></div>
          )}
        </section>
      </div>
    </div>
  );
}

function Profile({ name, all, scoped, ranked, totalScoped, alertThreshold, kindLabel }) {
  const mine = useMemo(() => scoped.filter((e) => e.name === name).sort((a, b) => (b.date || "").localeCompare(a.date || "")), [scoped, name]);
  const hours = sumHours(mine);
  const rank = ranked.findIndex((p) => p.name === name) + 1;
  const avgPerPerson = ranked.length ? totalScoped / ranked.length : 0;

  // Monthly: this person vs. the average of everyone with lost hours that month (same unit: hours).
  const monthly = useMemo(() => monthsSpan(scoped).map((k) => {
    const month = scoped.filter((e) => monthKey(e.date) === k);
    const peopleThatMonth = new Set(month.map((e) => e.name)).size;
    return {
      month: monthKeyLabel(k),
      mine: sumHours(month.filter((e) => e.name === name)),
      avg: peopleThatMonth ? Math.round((sumHours(month) / peopleThatMonth) * 10) / 10 : 0,
    };
  }), [scoped, name]);

  if (!mine.length) {
    const ever = all.filter((e) => e.name === name).length;
    return (
      <div className="thc-card">
        <h3 className="thc-profile-name">{name}</h3>
        <p className="thc-empty">{ever ? "אין היעדרויות בטווח שנבחר." : "לא נרשמו שעות שאבדו לאיש צוות זה."}</p>
      </div>
    );
  }

  return (
    <>
      <div className="thc-card thc-profile-head">
        <h3 className="thc-profile-name">
          {hours >= alertThreshold && <AlertTriangle size={17} className="thc-name-flag" aria-hidden="true" />}
          {name}
          {hours >= alertThreshold && <span className="thc-alert-badge">מעל סף {alertThreshold} השעות</span>}
        </h3>
        <button className="thc-ghost-btn" onClick={() => exportPersonCSV(name, mine)}><Download size={14} /> ייצוא רשומות</button>
      </div>

      <div className="thc-overview-grid thc-kpis">
        <Kpi label="שעות שאבדו" value={fmt(hours)} sub={`${pct(hours, totalScoped)} מכלל השעות של ${kindLabel}`} danger={hours >= alertThreshold} />
        <Kpi label="דירוג" value={`${rank}`} sub={`מתוך ${ranked.length} עם היעדרויות`} />
        <Kpi label="רשומות" value={mine.length} sub={`ממוצע ${fmt(hours / mine.length)} שעות לרשומה`} />
        <Kpi label="לעומת הממוצע" value={avgPerPerson ? `×${(hours / avgPerPerson).toFixed(1)}` : "—"} sub={`ממוצע לאיש צוות: ${fmt(avgPerPerson)} שעות`} />
        <Kpi label="היעדרות אחרונה" value={mine[0].date.split("-").reverse().join("/")} sub={DAY_NAMES[new Date(`${mine[0].date}T00:00:00`).getDay()]} />
      </div>

      <div className="thc-card">
        <h3>שעות שאבדו לפי חודש</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={monthly} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E3E7EE" vertical={false} />
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: "#D8DDD6" }} />
            <YAxis tick={numTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(27,42,74,0.06)" }} formatter={(v, n) => [`${fmt(v)} שעות`, n]} />
            <Legend wrapperStyle={{ fontFamily: "Assistant", fontWeight: 600 }} />
            <Bar isAnimationActive={false} dataKey="mine" name={name} fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={44} />
            <Line isAnimationActive={false} dataKey="avg" name={`ממוצע ${kindLabel} באותו חודש`} stroke={AVG_COLOR} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, fill: AVG_COLOR, stroke: "#fff", strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="thc-reports-row">
        <div className="thc-card"><h3>סיבות</h3><BarList rows={groupHours(mine, (e) => e.reason)} total={hours} limit={6} /></div>
        <div className="thc-card"><h3>מקצועות</h3><BarList rows={groupHours(mine, (e) => e.subject)} total={hours} limit={6} fill="linear-gradient(90deg, #2E6DA4, #5FA8DC)" /></div>
      </div>
      <div className="thc-reports-row">
        <div className="thc-card"><h3>ימים בשבוע</h3><BarList rows={byWeekday(mine).filter((d) => d.value > 0).sort((a, b) => b.value - a.value)} total={hours} limit={7} fill="linear-gradient(90deg, #3C5A78, #8FBEE0)" /></div>
        <div className="thc-card"><h3>כיתות</h3><BarList rows={byClass(mine)} total={hours} limit={6} fill="linear-gradient(90deg, #C96A1E, #F5B942)" /></div>
      </div>

      <div className="thc-card">
        <h3>כל הרשומות ({mine.length})</h3>
        <div className="thc-table-wrap thc-table-scroll">
          <table className="thc-table">
            <thead><tr><th>תאריך</th><th>יום</th><th>מקצוע</th><th>כיתה</th><th>שעות</th><th>סיבה</th><th>הערה</th></tr></thead>
            <tbody>
              {mine.map((e) => (
                <tr key={e.id}>
                  <td>{e.date.split("-").reverse().join("/")}</td>
                  <td>{DAY_NAMES[new Date(`${e.date}T00:00:00`).getDay()]}</td>
                  <td>{e.subject}</td>
                  <td>{[e.grade, e.parallel].filter(Boolean).join(" ")}</td>
                  <td className="thc-num">{fmt(Number(e.hours))}</td>
                  <td>{e.reason}</td>
                  <td className="thc-comment">{e.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
