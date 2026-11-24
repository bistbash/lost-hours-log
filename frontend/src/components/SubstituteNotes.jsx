import React, { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { readSubstituteNote } from "../lib/substituteNotes.js";

const dateText = (s) => (s || "").split("-").reverse().join("/");

/** Records whose note mentions a substitute that was not marked yet, with the person the note seems to point to. */
export function findSubstituteNotes(teacherEntries, instructorEntries, settings) {
  const names = [...new Set([...settings.teacherNames, ...settings.instructorNames])];
  const scan = (kind, list) => list
    .filter((e) => e.comment && !e.substitute)
    .map((e) => ({ kind, entry: e, guess: readSubstituteNote(e.comment, names, e.name) }))
    .filter((r) => r.guess);
  return [...scan("teachers", teacherEntries), ...scan("instructors", instructorEntries)]
    .sort((a, b) => (b.entry.date || "").localeCompare(a.entry.date || ""));
}

/** Turns old notes into the "מילוי מקום" field, after the user checks each one. The notes themselves stay. */
export default function SubstituteNotes({ rows, settings, onApply }) {
  const [chosen, setChosen] = useState({}); // id -> name the user picked ("" to leave out)
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const nameFor = (r) => chosen[`${r.kind}:${r.entry.id}`] ?? r.guess.name;
  const ready = useMemo(() => rows.filter((r) => nameFor(r)), [rows, chosen]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    setSaving(true);
    setNotice("");
    const done = await onApply(ready.map((r) => ({ kind: r.kind, id: r.entry.id, substitute: nameFor(r) })));
    setSaving(false);
    if (done) setNotice(ready.length === 1 ? "רשומה אחת הומרה." : `${ready.length} רשומות הומרו.`);
  };

  return (
    <>
      {notice && <p className="thc-setlist-note is-done" role="status">{notice}</p>}
      {rows.length === 0 ? (
        <p className="thc-empty">אין הערות שמחכות להמרה.</p>
      ) : (
        <>
          <div className="thc-table-wrap thc-notes-wrap">
            <table className="thc-table">
              <thead><tr><th>תאריך</th><th>מי נעדר</th><th>ההערה</th><th>מי מילא מקום</th><th>התאמה</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.kind}:${r.entry.id}`;
                  const name = nameFor(r);
                  const picked = chosen[key] !== undefined;
                  const state = !name ? "skip" : picked || r.guess.sure ? "sure" : "check";
                  return (
                    <tr key={key}>
                      <td>{dateText(r.entry.date)}</td>
                      <td>{r.entry.name}</td>
                      <td className="thc-comment">{r.entry.comment}</td>
                      <td>
                        <select value={name} onChange={(e) => setChosen((c) => ({ ...c, [key]: e.target.value }))} aria-label={`מי מילא מקום של ${r.entry.name}`}>
                          <option value="">לא להמיר</option>
                          <optgroup label="מורים">
                            {settings.teacherNames.filter((n) => n !== r.entry.name).map((n) => <option key={n} value={n}>{n}</option>)}
                          </optgroup>
                          <optgroup label="מדריכים">
                            {settings.instructorNames.filter((n) => n !== r.entry.name && !settings.teacherNames.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
                          </optgroup>
                        </select>
                      </td>
                      <td><span className={`thc-note-state is-${state}`}>{state === "sure" ? (picked ? "נבחר ידנית" : "שם מלא") : state === "check" ? "שם חלקי, לבדוק" : "לבחור שם"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="thc-notes-actions">
            <button type="button" className="thc-primary-btn" onClick={apply} disabled={saving || ready.length === 0}>
              <Check size={16} /> {ready.length === 1 ? "המרת רשומה אחת" : `המרת ${ready.length} רשומות`}
            </button>
            {ready.length < rows.length && <span className="thc-muted">{rows.length - ready.length === 1 ? "רשומה אחת בלי שם תישאר כמו שהיא." : `${rows.length - ready.length} רשומות בלי שם יישארו כמו שהן.`}</span>}
          </div>
        </>
      )}
    </>
  );
}
