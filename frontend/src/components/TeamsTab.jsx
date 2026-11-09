import React, { useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { BarList, Kpi, RangeBar } from "./ui.jsx";
import { fmt, groupHours, inRange, pct, sumHours, teamEntries, teamMembers } from "../lib/stats.js";

const KIND_LABEL = { teachers: "מורה", instructors: "מדריך/ה" };
const dateText = (s) => (s ? s.split("-").reverse().join("/") : "—");
const signed = (n) => (Math.abs(n) < 0.05 ? "כמו הממוצע" : `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`);

/** Teams in a side menu: one team's details, or several teams side by side. */
export default function TeamsTab({ teacherEntries, instructorEntries, settings, onPickPerson }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [mode, setMode] = useState("team"); // team | compare
  const [selectedId, setSelectedId] = useState(null);
  const [compareIds, setCompareIds] = useState(null); // null until the user picks: then the two biggest teams
  const threshold = settings.alertThreshold;

  const summaries = useMemo(() => {
    const teachers = inRange(teacherEntries, range.from, range.to);
    const instructors = inRange(instructorEntries, range.from, range.to);
    return settings.teams
      .map((team) => {
        const entries = teamEntries(team, teachers, instructors);
        const members = teamMembers(team, teachers, instructors);
        const hours = sumHours(entries);
        return {
          team,
          entries,
          members,
          hours,
          average: members.length ? hours / members.length : 0,
          absent: members.filter((m) => m.hours > 0).length,
          over: members.filter((m) => m.hours >= settings.alertThreshold).length,
          reasons: groupHours(entries, (e) => e.reason),
        };
      })
      .sort((a, b) => b.hours - a.hours || a.team.name.localeCompare(b.team.name, "he"));
  }, [settings.teams, settings.alertThreshold, teacherEntries, instructorEntries, range]);

  if (settings.teams.length === 0) {
    return (
      <div className="thc-card thc-empty-state">
        <h3>עדיין אין צוותים</h3>
        <p>מגדירים צוותים ומגמות ב"הגדרות", תחת "צוותים ומגמות".</p>
      </div>
    );
  }

  const current = summaries.find((s) => s.team.id === selectedId) || summaries[0];
  const chosenIds = (compareIds ?? summaries.slice(0, 2).map((s) => s.team.id)).filter((id) => summaries.some((s) => s.team.id === id));
  const compared = summaries.filter((s) => chosenIds.includes(s.team.id));
  const toggleCompare = (id) => setCompareIds(chosenIds.includes(id) ? chosenIds.filter((x) => x !== id) : [...chosenIds, id]);

  return (
    <div className="thc-reports">
      <div className="thc-card thc-filters">
        <RangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </div>

      <div className="thc-settings thc-teamview">
        <nav className="thc-settings-nav" aria-label="צוותים">
          <div className="thc-seg thc-teamview-mode">
            <button type="button" className={mode === "team" ? "active" : ""} onClick={() => setMode("team")}>צוות אחד</button>
            <button type="button" className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")}>השוואה</button>
          </div>
          <p className="thc-settings-group">{mode === "team" ? "בחרו צוות" : "סמנו צוותים להשוואה"}</p>
          {summaries.map((s) => {
            const on = mode === "team" ? s === current : chosenIds.includes(s.team.id);
            return (
              <button
                key={s.team.id}
                type="button"
                className={`thc-settings-link thc-teamview-link ${on ? "is-active" : ""}`}
                aria-pressed={on}
                onClick={() => (mode === "team" ? setSelectedId(s.team.id) : toggleCompare(s.team.id))}
              >
                {mode === "compare" && <span className={`thc-teamview-check ${on ? "is-on" : ""}`} aria-hidden="true">{on && <Check size={13} />}</span>}
                <span className="thc-teamview-name">
                  {s.team.name}
                  <small>{s.members.length} חברים</small>
                </span>
                <span className="thc-settings-count">{fmt(s.hours)} ש׳</span>
              </button>
            );
          })}
        </nav>

        <section className="thc-settings-panel">
          {mode === "team"
            ? <TeamDetail s={current} threshold={threshold} onPickPerson={onPickPerson} />
            : <TeamCompare teams={compared} threshold={threshold} />}
        </section>
      </div>
    </div>
  );
}

function TeamDetail({ s, threshold, onPickPerson }) {
  const top = s.reasons[0];
  return (
    <>
      <header className="thc-settings-head">
        <h3>{s.team.name}</h3>
        <span>{s.members.length} חברים · {s.entries.length} רשומות</span>
      </header>
      {s.members.length === 0 ? (
        <p className="thc-settings-hint">אין עדיין חברים בצוות הזה. מצרפים אותם ב"הגדרות", תחת "צוותים ומגמות".</p>
      ) : (
        <>
          <div className="thc-overview-grid thc-kpis thc-teamview-kpis">
            <Kpi label="שעות שאבדו" value={fmt(s.hours)} />
            <Kpi label="ממוצע לחבר צוות" value={fmt(s.average)} />
            <Kpi label="חברים עם היעדרות" value={s.absent} sub={`מתוך ${s.members.length}`} />
            <Kpi label={`מעל סף ${threshold} שעות`} value={s.over} danger={s.over > 0} />
          </div>
          <p className="thc-settings-hint">
            {top ? <>הסיבה המובילה בצוות: <b>{top.name}</b>, {fmt(top.value)} שעות ({pct(top.value, s.hours)}).</> : "אין רשומות בטווח שנבחר."}
          </p>

          <div className="thc-teamview-row">
            <div>
              <h4 className="thc-team-section">מי איבד כמה שעות</h4>
              <BarList rows={s.members.map((m) => ({ name: m.name, value: m.hours, count: m.count }))} total={s.hours} limit={12} onPick={onPickPerson} />
            </div>
            <div>
              <h4 className="thc-team-section">סיבות הביטול</h4>
              <BarList rows={s.reasons} total={s.hours} limit={8} mode="percent" />
            </div>
          </div>

          <h4 className="thc-team-section">פירוט חברי הצוות</h4>
          <div className="thc-table-wrap">
            <table className="thc-table">
              <thead>
                <tr><th>שם</th><th>תפקיד</th><th>שעות</th><th>חלק מהצוות</th><th>מול הממוצע</th><th>רשומות</th><th>סיבה מובילה</th><th>היעדרות אחרונה</th></tr>
              </thead>
              <tbody>
                {s.members.map((m) => (
                  <tr key={`${m.kind}-${m.name}`}>
                    <td>
                      <button type="button" className="thc-link" onClick={() => onPickPerson(m.name, m.kind)}>
                        {m.hours >= threshold && <AlertTriangle size={13} className="thc-name-flag" aria-label="מעל הסף" />}
                        {m.name}
                      </button>
                    </td>
                    <td>{KIND_LABEL[m.kind]}</td>
                    <td><b>{fmt(m.hours)}</b></td>
                    <td>{pct(m.hours, s.hours)}</td>
                    <td>{signed(m.hours - s.average)}</td>
                    <td>{m.count}</td>
                    <td>{m.topReason}</td>
                    <td>{dateText(m.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** Rows are measures, columns are teams; the highest loss in each row is marked. */
function TeamCompare({ teams, threshold }) {
  if (teams.length < 2) {
    return (
      <>
        <header className="thc-settings-head"><h3>השוואה בין צוותים</h3></header>
        <p className="thc-settings-hint">סמנו בתפריט לפחות שני צוותים כדי להשוות ביניהם.</p>
      </>
    );
  }

  const rows = [
    { label: "שעות שאבדו", value: (s) => s.hours, show: (s) => fmt(s.hours), mark: true },
    { label: "ממוצע לחבר צוות", value: (s) => s.average, show: (s) => fmt(s.average), mark: true },
    { label: "חברים", value: (s) => s.members.length, show: (s) => s.members.length },
    { label: "חברים עם היעדרות", value: (s) => s.absent, show: (s) => `${s.absent} (${pct(s.absent, s.members.length)})` },
    { label: "רשומות", value: (s) => s.entries.length, show: (s) => s.entries.length },
    { label: `מעל סף ${threshold} שעות`, value: (s) => s.over, show: (s) => s.over, mark: true },
    { label: "סיבה מובילה", show: (s) => s.reasons[0]?.name || "—" },
  ];

  // The reasons that matter most across the chosen teams, as a share of each team's hours.
  const reasonNames = groupHours(teams.flatMap((s) => s.entries), (e) => e.reason).slice(0, 6).map((r) => r.name);
  const reasonHours = (s, name) => s.reasons.find((r) => r.name === name)?.value || 0;

  const shared = new Map();
  for (const s of teams) for (const m of s.members) shared.set(`${m.kind}-${m.name}`, (shared.get(`${m.kind}-${m.name}`) || 0) + 1);
  const overlap = [...shared.values()].filter((n) => n > 1).length;

  return (
    <>
      <header className="thc-settings-head">
        <h3>השוואה בין {teams.length} צוותים</h3>
      </header>
      <p className="thc-settings-hint">
        הסימון הכתום מראה את הצוות עם הערך הגבוה בכל שורה.
        {overlap === 1 && " אדם אחד שייך ליותר מאחד מהצוותים, והשעות שלו נספרות בכל צוות."}
        {overlap > 1 && ` ${overlap} אנשים שייכים ליותר מאחד מהצוותים, והשעות שלהם נספרות בכל צוות.`}
      </p>

      <div className="thc-table-wrap">
        <table className="thc-table thc-compare-table">
          <thead>
            <tr><th />{teams.map((s) => <th key={s.team.id}>{s.team.name}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const peak = row.mark ? Math.max(...teams.map(row.value)) : null;
              return (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {teams.map((s) => (
                    <td key={s.team.id} className={row.mark && peak > 0 && row.value(s) === peak ? "is-peak" : ""}>{row.show(s)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="thc-teamview-row">
        <div>
          <h4 className="thc-team-section">ממוצע שעות לחבר צוות</h4>
          <BarList rows={teams.map((s) => ({ name: s.team.name, value: s.average })).sort((a, b) => b.value - a.value)} total={0} limit={12} />
        </div>
        <div>
          <h4 className="thc-team-section">סך השעות שאבדו</h4>
          <BarList rows={teams.map((s) => ({ name: s.team.name, value: s.hours, count: s.entries.length })).sort((a, b) => b.value - a.value)} total={0} limit={12} />
        </div>
      </div>

      {reasonNames.length > 0 && (
        <>
          <h4 className="thc-team-section">חלק כל סיבה מהשעות של הצוות</h4>
          <div className="thc-table-wrap">
            <table className="thc-table thc-compare-table">
              <thead>
                <tr><th>סיבה</th>{teams.map((s) => <th key={s.team.id}>{s.team.name}</th>)}</tr>
              </thead>
              <tbody>
                {reasonNames.map((name) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    {teams.map((s) => {
                      const h = reasonHours(s, name);
                      return <td key={s.team.id}>{h ? `${pct(h, s.hours)} · ${fmt(h)} ש׳` : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
