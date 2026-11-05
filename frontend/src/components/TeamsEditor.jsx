import React, { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { searchKey } from "../lib/stats.js";

const KINDS = [
  { id: "teachers", label: "מורים", roster: "teacherNames" },
  { id: "instructors", label: "מדריכים", roster: "instructorNames" },
];

/** Settings panel: create teams and majors, and assign people to them. People may belong to several. */
export default function TeamsEditor({ settings, query, onChange, makeId }) {
  const { teams } = settings;
  const [selectedId, setSelectedId] = useState(teams[0]?.id ?? null);
  const [kind, setKind] = useState("teachers");
  const [draft, setDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingFor, setAddingFor] = useState(null); // The member being added to another team.
  const [notice, setNotice] = useState("");

  const key = searchKey(query);
  const selected = teams.find((t) => t.id === selectedId) || teams[0] || null;

  useEffect(() => {
    setNameDraft(selected?.name ?? "");
    setConfirmDelete(false);
    setError("");
    setAddingFor(null);
    setNotice("");
  }, [selected?.id, selected?.name, kind]);

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
  const addMember = (name) => { patchSelected({ [kind]: [...selected[kind], name] }); setNotice(""); };
  const removeMember = (name) => {
    patchSelected({ [kind]: selected[kind].filter((n) => n !== name) });
    setAddingFor(null);
    setNotice("");
  };
  const addToTeam = (team) => {
    onChange(teams.map((t) => (t.id === team.id ? { ...t, [kind]: [...t[kind], addingFor] } : t)));
    setNotice(`${addingFor} נוסף/ה גם לצוות ${team.name}`);
    setAddingFor(null);
  };

  const matches = (n) => !key || searchKey(n).includes(key);
  const teamsOf = (name) => teams.filter((t) => t[kind].includes(name));
  const roster = settings[KINDS.find((k) => k.id === kind).roster];
  const members = selected ? selected[kind].filter(matches) : [];
  const unassigned = roster.filter((n) => teamsOf(n).length === 0 && matches(n));
  const otherTeams = addingFor ? teams.filter((t) => !t[kind].includes(addingFor)) : [];

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

          <h4 className="thc-team-section">בצוות <span>{selected[kind].length}</span></h4>
          <div className="thc-setlist">
            {members.length === 0 && <p className="thc-setlist-empty">{key ? "לא נמצאו תוצאות בצוות" : "עדיין אין חברים. לחצו על שם ברשימה למטה כדי לצרף."}</p>}
            {members.map((name) => {
              const others = teamsOf(name).filter((t) => t.id !== selected.id).map((t) => t.name);
              return (
                <div key={name} className="thc-setlist-item" title={others.length ? `גם ב: ${others.join(", ")}` : undefined}>
                  <span className="thc-setlist-text">
                    {name}
                    {others.length > 0 && <small> גם ב{others.join(", ")}</small>}
                  </span>
                  <span className="thc-setlist-actions">
                    <button type="button" onClick={() => { setAddingFor(name); setNotice(""); }} aria-label={`הוספת ${name} לצוות נוסף`} title="הוספה לצוות נוסף"><Plus size={15} /></button>
                    <button type="button" className="is-delete" onClick={() => removeMember(name)} aria-label={`הסרת ${name} מהצוות`} title="הסרה מהצוות"><X size={15} /></button>
                  </span>
                </div>
              );
            })}
          </div>

          {addingFor && (
            <div className="thc-team-addto">
              <span>{otherTeams.length ? `להוסיף את ${addingFor} גם לצוות:` : `${addingFor} כבר נמצא/ת בכל הצוותים`}</span>
              {otherTeams.map((t) => (
                <button key={t.id} type="button" className="thc-team-pill" onClick={() => addToTeam(t)}>{t.name}</button>
              ))}
              <button type="button" className="thc-team-addto-close" onClick={() => setAddingFor(null)} aria-label="סגירה"><X size={15} /></button>
            </div>
          )}
          {notice && <p className="thc-setlist-note is-done" role="status">{notice}</p>}

          <h4 className="thc-team-section">לא משויכים <span>{unassigned.length}</span></h4>
          <div className="thc-setlist">
            {unassigned.length === 0 && <p className="thc-setlist-empty">{key ? "לא נמצאו תוצאות" : "כולם משויכים לצוות"}</p>}
            {unassigned.map((name) => (
              <button key={name} type="button" className="thc-team-member" onClick={() => addMember(name)} title={`צירוף ל${selected.name}`}>
                <span className="thc-setlist-text">{name}</span>
                <Plus size={15} aria-hidden="true" />
              </button>
            ))}
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
