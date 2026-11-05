import React, { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BarList, Kpi, RangeBar } from "./ui.jsx";
import { fmt, groupHours, inRange, pct, sumHours, teamEntries, teamMembers } from "../lib/stats.js";

const KIND_LABEL = { teachers: "מורה", instructors: "מדריך/ה" };
const dateText = (s) => (s ? s.split("-").reverse().join("/") : "—");
const signed = (n) => (Math.abs(n) < 0.05 ? "כמו הממוצע" : `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`);

/** Compares the teams with each other, then the members of one team with each other. */
export default function TeamsTab({ teacherEntries, instructorEntries, settings, onPickPerson }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [selectedId, setSelectedId] = useState(null);
  const threshold = settings.alertThreshold;

  const summaries = useMemo(() => {
    const teachers = inRange(teacherEntries, range.from, range.to);
    const instructors = inRange(instructorEntries, range.from, range.to);
    return settings.teams
      .map((team) => {
        const entries = teamEntries(team, teachers, instructors);
        const members = teamMembers(team, teachers, instructors);
        const hours = sumHours(entries);
        return { team, entries, members, hours, average: members.length ? hours / members.length : 0 };
      })
      .sort((a, b) => b.hours - a.hours || a.team.name.localeCompare(b.team.name, "he"));
  }, [settings.teams, teacherEntries, instructorEntries, range]);

  if (settings.teams.length === 0) {
    return (
      <div className="thc-card thc-empty-state">
        <h3>עדיין אין צוותים</h3>
        <p>מגדירים צוותים ומגמות ב"הגדרות", תחת "צוותים ומגמות".</p>
      </div>
    );
  }

  const current = summaries.find((s) => s.team.id === selectedId) || summaries[0];
  const maxHours = summaries[0]?.hours || 1;
  const reasons = groupHours(current.entries, (e) => e.reason);
  const absent = current.members.filter((m) => m.hours > 0).length;
  const over = current.members.filter((m) => m.hours >= threshold).length;

  return (
    <div className="thc-reports">
      <div className="thc-card thc-filters">
        <RangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </div>

      <div className="thc-card">
        <div className="thc-subject-header">
          <h3>השוואה בין הצוותים</h3>
          <span className="thc-muted">מי ששייך לכמה צוותים נספר בכל אחד מהם</span>
        </div>
        <div className="thc-table-wrap">
          <table className="thc-table thc-team-table">
            <thead>
              <tr><th>צוות</th><th>חברים</th><th>שעות שאבדו</th><th>ממוצע לחבר</th></tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.team.id} className={s === current ? "is-selected" : ""}>
                  <td>
                    <button type="button" className="thc-link thc-team-link" aria-pressed={s === current} onClick={() => setSelectedId(s.team.id)}>
                      {s.team.name}
                    </button>
                  </td>
                  <td>{s.members.length}</td>
                  <td className="thc-team-hours">
                    <span className="thc-barlist-track">
                      <span className="thc-barlist-fill" style={{ width: `${s.hours ? Math.max(2, (s.hours / maxHours) * 100) : 0}%` }} />
                    </span>
                    <span>{fmt(s.hours)}</span>
                  </td>
                  <td>{fmt(s.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="thc-team-title">{current.team.name}</h2>

      {current.members.length === 0 ? (
        <div className="thc-card"><p className="thc-empty">אין עדיין חברים בצוות הזה. מצרפים אותם ב"הגדרות", תחת "צוותים ומגמות".</p></div>
      ) : (
        <>
          <div className="thc-overview-grid thc-kpis">
            <Kpi label="שעות שאבדו בצוות" value={fmt(current.hours)} sub={`${current.entries.length} רשומות`} />
            <Kpi label="ממוצע לחבר צוות" value={fmt(current.average)} sub={`${current.members.length} חברים`} />
            <Kpi label="חברים עם היעדרות" value={absent} sub={`מתוך ${current.members.length}`} />
            <Kpi label={`מעל סף ${threshold} שעות`} value={over} danger={over > 0} />
            <Kpi label="הסיבה המובילה" value={<span className="thc-kpi-text">{reasons[0]?.name || "—"}</span>} sub={reasons[0] ? `${fmt(reasons[0].value)} שעות (${pct(reasons[0].value, current.hours)})` : null} />
          </div>

          <div className="thc-reports-row">
            <div className="thc-card">
              <h3>מי איבד כמה שעות</h3>
              <BarList
                rows={current.members.map((m) => ({ name: m.name, value: m.hours, count: m.count }))}
                total={current.hours}
                limit={12}
                onPick={onPickPerson}
              />
            </div>
            <div className="thc-card">
              <h3>סיבות הביטול בצוות</h3>
              <BarList rows={reasons} total={current.hours} limit={8} mode="percent" />
            </div>
          </div>

          <div className="thc-card">
            <div className="thc-subject-header">
              <h3>פירוט חברי הצוות</h3>
              <span className="thc-muted">לחיצה על שם פותחת את הכרטיס האישי</span>
            </div>
            <div className="thc-table-wrap">
              <table className="thc-table">
                <thead>
                  <tr><th>שם</th><th>תפקיד</th><th>שעות</th><th>חלק מהצוות</th><th>מול הממוצע</th><th>רשומות</th><th>סיבה מובילה</th><th>היעדרות אחרונה</th></tr>
                </thead>
                <tbody>
                  {current.members.map((m) => (
                    <tr key={`${m.kind}-${m.name}`}>
                      <td>
                        <button type="button" className="thc-link" onClick={() => onPickPerson(m.name, m.kind)}>
                          {m.hours >= threshold && <AlertTriangle size={13} className="thc-name-flag" aria-label="מעל הסף" />}
                          {m.name}
                        </button>
                      </td>
                      <td>{KIND_LABEL[m.kind]}</td>
                      <td><b>{fmt(m.hours)}</b></td>
                      <td>{pct(m.hours, current.hours)}</td>
                      <td>{signed(m.hours - current.average)}</td>
                      <td>{m.count}</td>
                      <td>{m.topReason}</td>
                      <td>{dateText(m.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
