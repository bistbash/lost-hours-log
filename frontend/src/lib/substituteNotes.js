import { searchKey } from "./stats.js";

/** Words compared without quotes and with final letters folded, as searchKey does. */
const wordsOf = (s) => searchKey(s).split(/[^א-תa-z0-9]+/).filter(Boolean);
const set = (list) => new Set(list.map((w) => searchKey(w)));

const FILL = set(["מילוי", "במילוי", "מילא", "מילאה", "מילאו", "ממלא", "ממלאת"]);
const PLACE = set(["מקום", "מקומו", "מקומה", "המקום"]);
const NOT = set(["לא", "אין", "ללא", "בלי"]);
const WAS = set(["היה", "היתה", "הייתה", "נמצא", "נמצאה"]);
const SKIP = set(["עי", "על", "ידי", "של", "עם", "את", "מורה", "המורה", "מדריך", "המדריך", "מדריכה", "המדריכה", "היה", "הייתה"]);

/** Where the note says someone filled in: the word range, or null. "לא היה מ"מ" and the like do not count. */
function findMention(words) {
  for (let i = 0; i < words.length; i++) {
    let end = 0;
    if (words[i] === "ממ") end = i + 1;
    else if (FILL.has(words[i]) && PLACE.has(words[i + 1])) end = i + 2;
    if (!end) continue;
    const before = NOT.has(words[i - 1]) || (WAS.has(words[i - 1]) && NOT.has(words[i - 2]));
    const after = words[end] === searchKey("אין") || (NOT.has(words[end]) && (words.length === end + 1 || WAS.has(words[end + 1])));
    if (!before && !after) return { start: i, end };
  }
  return null;
}

/** Names found in the words: `full` when every part of the name appears, `partial` when only some do. */
function findNames(words, names) {
  const present = new Set(words.filter((w) => !SKIP.has(w)));
  // "ותמר" is also "תמר", so a second person in the note is noticed.
  for (const w of words) if (w.length > 2 && w[0] === "ו") present.add(w.slice(1));
  const full = [];
  const partial = [];
  for (const name of names) {
    const parts = wordsOf(name);
    const hits = parts.filter((p) => present.has(p)).length;
    if (parts.length && hits === parts.length) full.push(name);
    else if (hits > 0) partial.push(name);
  }
  return { full, partial };
}

/**
 * Reads a free-text note such as `מ"מ ע"י מורה X`. Null when it does not mention a substitute; otherwise
 * { name, sure }: the person it points to ("" when unknown or more than one), and whether the whole name was written.
 */
export function readSubstituteNote(comment, names, absentName) {
  const words = wordsOf(comment);
  const mention = findMention(words);
  if (!mention) return null;
  const others = names.filter((n) => n !== absentName);
  // Normally the name comes after; `תמר מילאה מקום` has it before, and there only a whole name is trusted.
  const after = findNames(words.slice(mention.end), others);
  if (after.full.length) return after.full.length === 1 ? { name: after.full[0], sure: true } : { name: "", sure: false };
  if (after.partial.length) return { name: after.partial.length === 1 ? after.partial[0] : "", sure: false };
  const before = findNames(words.slice(0, mention.start), others);
  return before.full.length === 1 ? { name: before.full[0], sure: true } : { name: "", sure: false };
}
