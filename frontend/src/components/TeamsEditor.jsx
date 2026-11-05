import React, { useEffect, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { searchKey } from "../lib/stats.js";

const KINDS = [
  { id: "teachers", label: "מורים", roster: "teacherNames" },
  { id: "instructors", label: "מדריכים", roster: "instructorNames" },
];

/** Settings panel: create teams and majors, and choose who belongs to each. People may belong to several. */
export default function TeamsEditor({ settings, query, onChange, makeId }) {
  const { teams } = settings;
  const [selectedId, setSelectedId] = useState(teams[0]?.id ?? null);
  const [kind, setKind] = useState("teachers");
  const [draft, setDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const key = searchKey(query);
  const selected = teams.find((t) => t.id === selectedId) || teams[0] || null;

  useEffect(() => {
    setNameDraft(selected?.name ?? "");
    setConfirmDelete(false);
    setError("");
  }, [selected?.id, selected?.name]);

  const nameTaken = (name, id) => teams.some((t) => t.id !== id && searchKey(t.name) === searchKey(name));
  const patchSelected = (patch) => onChange(teams.map((t) => (t.id === selected.id ? { ...t, ...patch } : t)));

  const addTeam = () => {
    const name = draft.trim();
    if (!name) return;
    if (nameTaken(name)) { setError(`כבר קיים צוות בשם "${name}"`); return; }
    const team = { id: makeId(), name, teachers: [], instructors: [] };
    onChange([...teams, team]);
    setSelectedId(team.id);
    setDraft("");
    setError("");
  };
  const renameTeam = () => {
    const name = nameDraft.trim();
    if (name === selected.name) return;
    if (!name || nameTaken(name, selected.id)) {
      setError(name ? `כבר קיים צוות בשם "${name}"` : "לצוות חייב להיות שם");
      setNameDraft(selected.name);
      return;
    }
    setError("");
    patchSelected({ name });
  };
  const deleteTeam = () => {
    onChange(teams.filter((t) => t.id !== selected.id));
    setSelectedId(null);
  };
  const toggleMember = (name) => {
    const members = selected[kind];
    patchSelected({ [kind]: members.includes(name) ? members.filter((n) => n !== name) : [...members, name] });
  };

  // Someone removed from the staff lists stays visible here, so they can still be taken out of the team.
  const roster = selected ? settings[KINDS.find((k) => k.id === kind).roster] : [];
  const options = selected ? [...roster, ...selected[kind].filter((n) => !roster.includes(n))] : [];
  const visible = key ? options.filter((n) => searchKey(n).includes(key)) : options;
  const memberNames = selected ? [...selected.teachers, ...selected.instructors] : [];

  return (
    <>
      <div className="thc-team-pills" role="group" aria-label="צוותים">
        {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`thc-team-pill ${selected?.id === t.id ? "is-active" : ""}`}
            aria-pressed={selected?.id === t.id}
            onClick={() => setSelectedId(t.id)}
          >
            {t.name} <span>{t.teachers.length + t.instructors.length}</span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="thc-team-body">
          <div className="thc-team-head">
            <label>
              שם הצוות
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={renameTeam}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
            </label>
            <div className="thc-seg">
              {KINDS.map((k) => (
                <button key={k.id} type="button" className={kind === k.id ? "active" : ""} onClick={() => setKind(k.id)}>
                  {k.label} ({selected[k.id].length})
                </button>
              ))}
            </div>
            <button type="button" className="thc-team-delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} /> מחיקת צוות
            </button>
          </div>

          {confirmDelete && (
            <div className="thc-team-confirm" role="alert">
              <span>למחוק את "{selected.name}"? האנשים והרשומות שלהם לא יימחקו.</span>
              <button type="button" className="thc-danger-btn" onClick={deleteTeam}>כן, מחיקה</button>
              <button type="button" className="thc-ghost-btn" onClick={() => setConfirmDelete(false)}>ביטול</button>
            </div>
          )}

          <p className="thc-team-summary">
            {memberNames.length ? <><b>בצוות:</b> {memberNames.join(", ")}</> : "עדיין אין חברים בצוות. לחצו על שמות למטה כדי לצרף."}
          </p>

          <div className="thc-setlist">
            {options.length === 0 && <p className="thc-setlist-empty">אין שמות ברשימה. הוסיפו אותם ב"שמות {KINDS.find((k) => k.id === kind).label}".</p>}
            {options.length > 0 && visible.length === 0 && <p className="thc-setlist-empty">לא נמצאו תוצאות</p>}
            {visible.map((name) => {
              const on = selected[kind].includes(name);
              return (
                <button key={name} type="button" className={`thc-team-member ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => toggleMember(name)}>
                  <span className="thc-setlist-text">{name}</span>
                  {on && <Check size={16} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="thc-setlist-empty">עדיין אין צוותים. אפשר להוסיף את הראשון כאן למטה.</p>
      )}

      {error && <p className="thc-setlist-note is-error" role="alert">{error}</p>}
      <div className="thc-setlist-add">
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && addTeam()}
          aria-label="צוות חדש"
          placeholder="שם צוות או מגמה חדשים, למשל: ספרות"
        />
        <button type="button" onClick={addTeam}><Plus size={16} /> הוספה</button>
      </div>
    </>
  );
}
