/** Aggregations for reports and the per-person view. Entries: { name, subject, grade, parallel, date, hours, reason }. */

export const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const MONTH_NAMES = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

export const DAY_COLORS = {
  "ראשון": { bg: "#FBDADA", fg: "#8A2E2E" },
  "שני":   { bg: "#D6E8F7", fg: "#1F4E79" },
  "שלישי": { bg: "#FBE7C6", fg: "#7A5A10" },
  "רביעי": { bg: "#D9F2D9", fg: "#2C6B2C" },
  "חמישי": { bg: "#E6D9F2", fg: "#5A2E82" },
  "שישי":  { bg: "#D6F0F0", fg: "#1F6B6B" },
  "שבת":   { bg: "#E7E7E7", fg: "#4A4A4A" },
};
export const MONTH_COLORS = [
  { bg: "#FBDADA", fg: "#8A2E2E" }, { bg: "#FBE7C6", fg: "#7A5A10" }, { bg: "#F7F0C6", fg: "#6B5E10" },
  { bg: "#D9F2D9", fg: "#2C6B2C" }, { bg: "#D6F0F0", fg: "#1F6B6B" }, { bg: "#D6E8F7", fg: "#1F4E79" },
  { bg: "#DDD9F2", fg: "#3C2E82" }, { bg: "#E6D9F2", fg: "#5A2E82" }, { bg: "#F2D9EC", fg: "#822E6E" },
  { bg: "#F2D9DD", fg: "#822E44" }, { bg: "#EAD9C6", fg: "#6B4A10" }, { bg: "#D9E0D0", fg: "#3E5A2C" },
];

export const hoursOf = (e) => Number(e.hours || 0);
export const sumHours = (list) => list.reduce((s, e) => s + hoursOf(e), 0);
export const monthKey = (dateStr) => (dateStr ? dateStr.slice(0, 7) : "");
export const monthKeyLabel = (key) => {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} '${y.slice(2)}`;
};
export const weekdayIndex = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? -1 : d.getDay();
};

/** Rounds for display: integers stay integers, others get one decimal. */
export const fmt = (n) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1));
export const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "0%");

/** { key -> hours } for a key function, sorted descending as [{ name, value, count }]. */
export function groupHours(list, keyFn) {
  const map = new Map();
  for (const e of list) {
    const k = keyFn(e) || "לא צוין";
    const cur = map.get(k) || { name: k, value: 0, count: 0 };
    cur.value += hoursOf(e);
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/** Every month between the first and last entry (empty months included), oldest first. */
export function monthsSpan(list) {
  const keys = list.map((e) => monthKey(e.date)).filter(Boolean).sort();
  if (!keys.length) return [];
  const out = [];
  let [y, m] = keys[0].split("-").map(Number);
  const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Hours per weekday (Sunday..Friday; Saturday only if it has data). */
export function byWeekday(list) {
  const hours = Array(7).fill(0);
  const count = Array(7).fill(0);
  for (const e of list) {
    const i = weekdayIndex(e.date);
    if (i < 0) continue;
    hours[i] += hoursOf(e);
    count[i] += 1;
  }
  return DAY_NAMES.map((name, i) => ({ name, value: hours[i], count: count[i] })).filter((d, i) => i < 6 || d.value > 0);
}

/** Classes as "יא 3", sorted by hours lost. */
export const byClass = (list) => groupHours(list, (e) => (e.grade ? `${e.grade}${e.parallel ? ` ${e.parallel}` : ""}` : ""));

/** Inclusive date filter on YYYY-MM-DD strings; empty bounds are open. */
export const inRange = (list, from, to) => list.filter((e) => e.date && (!from || e.date >= from) && (!to || e.date <= to));

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The same-length period right before [from, to], for comparisons. Null when the range is open. */
export function previousPeriod(from, to) {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const days = Math.round((b - a) / 86400000) + 1;
  const prevTo = new Date(a);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { from: iso(prevFrom), to: iso(prevTo) };
}

/** Quick ranges; the school year starts on September 1st. */
export function rangePresets(today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const schoolStart = new Date(m >= 8 ? y : y - 1, 8, 1);
  const monthStart = new Date(y, m, 1);
  const last30 = new Date(today);
  last30.setDate(last30.getDate() - 29);
  const prevMonthStart = new Date(y, m - 1, 1);
  const prevMonthEnd = new Date(y, m, 0);
  return [
    { id: "all", label: "הכל", from: "", to: "" },
    { id: "school", label: "שנת הלימודים", from: iso(schoolStart), to: iso(today) },
    { id: "month", label: "החודש", from: iso(monthStart), to: iso(today) },
    { id: "prevMonth", label: "החודש הקודם", from: iso(prevMonthStart), to: iso(prevMonthEnd) },
    { id: "30", label: "30 יום", from: iso(last30), to: iso(today) },
  ];
}

/** Per-person totals: [{ name, hours, count, last, topReason }], most hours first. */
export function people(list) {
  const map = new Map();
  for (const e of list) {
    if (!e.name) continue;
    const p = map.get(e.name) || { name: e.name, hours: 0, count: 0, last: "", reasons: new Map() };
    p.hours += hoursOf(e);
    p.count += 1;
    if (e.date > p.last) p.last = e.date;
    const r = e.reason || "לא צוין";
    p.reasons.set(r, (p.reasons.get(r) || 0) + hoursOf(e));
    map.set(e.name, p);
  }
  return [...map.values()]
    .map(({ reasons, ...p }) => {
      const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ...p, topReason: top ? top[0] : "—", topReasonHours: top ? top[1] : 0 };
    })
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, "he"));
}

/** A team's entries, each tagged with its kind. Teams hold { teachers: names[], instructors: names[] }. */
export function teamEntries(team, teachers, instructors) {
  const pick = (list, names, kind) => {
    const set = new Set(names);
    return list.filter((e) => set.has(e.name)).map((e) => ({ ...e, kind }));
  };
  return [...pick(teachers, team.teachers, "teachers"), ...pick(instructors, team.instructors, "instructors")];
}

/** Every member of a team with their totals, including people with no lost hours; most hours first. */
export function teamMembers(team, teachers, instructors) {
  const rows = (names, list, kind) => {
    const totals = new Map(people(list).map((p) => [p.name, p]));
    return names.map((name) => ({ name, hours: 0, count: 0, last: "", topReason: "—", ...totals.get(name), kind }));
  };
  return [...rows(team.teachers, teachers, "teachers"), ...rows(team.instructors, instructors, "instructors")]
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, "he"));
}

/** Hebrew-friendly search key: no quotes/geresh, final letters folded, lower-case. */
export function searchKey(s) {
  return String(s || "")
    .replace(/["'״׳`]/g, "")
    .replace(/[ךםןףץ]/g, (c) => ({ ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" })[c])
    .toLowerCase()
    .trim();
}

/** Every query word must appear in the text; names that start with the query rank first. */
export function matchNames(names, query) {
  const q = searchKey(query);
  if (!q) return names;
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const n of names) {
    const k = searchKey(n);
    if (!words.every((w) => k.includes(w))) continue;
    const startsWord = k.split(/\s+/).some((part) => part.startsWith(words[0]));
    scored.push({ n, score: (k.startsWith(q) ? 0 : startsWord ? 1 : 2) });
  }
  return scored.sort((a, b) => a.score - b.score || a.n.localeCompare(b.n, "he")).map((s) => s.n);
}
