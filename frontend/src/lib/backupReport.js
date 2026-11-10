/**
 * The backup file: a designed Excel workbook with a summary, a report per population, and the full records.
 * The "רשומות ..." sheets keep the import columns, so the file can be loaded back through the import panel.
 * ExcelJS is large, so it is only loaded when a backup is made.
 */
import {
  DAY_COLORS, DAY_NAMES, MONTH_COLORS, MONTH_NAMES, byClass, byWeekday, fmt, groupHours, hoursOf, monthKey,
  monthKeyLabel, monthsSpan, people, sumHours, weekdayIndex,
} from "./stats.js";

const SCHOOL = "טכני באר שבע";
const FONT = "Arial";
const NAVY = "1B2A4A";
const INK = "2B3648";
const SOFT = "6B7686";
const LINE = "DDE3EC";
const ZEBRA = "F7F9FC";
const WHITE = "FFFFFF";
const DANGER = "B3261E";
const DANGER_BG = "FDEDEB";
const OK = "2C6B2C";
const OK_BG = "E6F4E6";

const THEMES = {
  summary: { head: NAVY, accent: NAVY, tint: "EEF2F7", bar: "9DB0CC" },
  teachers: { head: "2E6DA4", accent: "245A8A", tint: "E8F1F8", bar: "9CC3E4" },
  instructors: { head: "B85F10", accent: "A85510", tint: "FDF0E3", bar: "F5BE8A" },
};

const POPULATIONS = {
  teachers: { key: "teachers", plural: "מורים", report: "דוח מורים", records: "רשומות מורים", theme: THEMES.teachers },
  instructors: { key: "instructors", plural: "מדריכים", report: "דוח מדריכים", records: "רשומות מדריכים", theme: THEMES.instructors },
};

const RECORD_COLUMNS = [
  { header: "שם", width: 24 }, { header: "מקצוע", width: 18 }, { header: "שכבה", width: 10 }, { header: "מספר כיתה", width: 14 },
  { header: "תאריך", width: 13 }, { header: "יום", width: 10 }, { header: "חודש", width: 11 }, { header: "שעות", width: 10 },
  { header: "סיבה", width: 24 }, { header: "הערה", width: 34 },
];
const RECORDS_HEADER_ROW = 5; // The import panel looks for the column titles in the first five rows.

/** Report grid: A is a margin; B-E and G-I hold side-by-side tables, F separates them. */
const REPORT_WIDTHS = [2, 6, 24, 10, 18, 10, 24, 12, 16, 2];
const RIGHT = { first: 2, second: 4, third: 5 }; // name B:C, hours D, share E
const LEFT = { first: 7, second: 8, third: 9 }; // name G, hours H, share I

const argb = (hex) => `FF${hex}`;
const fill = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
const font = (size, color = INK, bold = false) => ({ name: FONT, size, bold, color: { argb: argb(color) } });
const hairline = { style: "thin", color: { argb: argb(LINE) } };
const round1 = (n) => Math.round(n * 10) / 10;
const dateCell = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : s || "";
};
const dateText = (s) => (s ? s.split("-").reverse().join("/") : "");

function put(ws, row, c1, c2, value, style = {}) {
  if (c2 > c1) ws.mergeCells(row, c1, row, c2);
  for (let c = c1; c <= c2; c += 1) {
    if (style.fill) ws.getCell(row, c).fill = style.fill;
    if (style.border) ws.getCell(row, c).border = style.border;
  }
  const cell = ws.getCell(row, c1);
  cell.value = value;
  cell.font = style.font || font(10);
  cell.alignment = { vertical: "middle", horizontal: style.align || "right", wrapText: !!style.wrap, readingOrder: "rtl" };
  if (style.numFmt) cell.numFmt = style.numFmt;
  return cell;
}

function newSheet(wb, name, theme, widths, landscape = false) {
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: argb(theme.head) } },
    views: [{ rightToLeft: true, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: landscape ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
    },
    headerFooter: { oddFooter: `&L&8עמוד &P מתוך &N&R&8${SCHOOL}` },
  });
  widths.forEach((width, i) => { ws.getColumn(i + 1).width = width; });
  return ws;
}

/** Logo, title and subtitle; returns the next free row. */
function reportHeader(ws, ctx, theme, title) {
  ws.getRow(1).height = 10;
  [34, 20, 18].forEach((h, i) => { ws.getRow(i + 2).height = h; });
  if (ctx.logoId != null) {
    ws.addImage(ctx.logoId, { tl: { col: 8.3, row: 1.05 }, ext: { width: 72, height: 72 }, editAs: "oneCell" });
  }
  put(ws, 2, 2, 8, title, { font: font(21, theme.accent, true) });
  put(ws, 3, 2, 8, `${SCHOOL} · ${ctx.periodText}`, { font: font(10.5, INK) });
  put(ws, 4, 2, 8, `הופק ב-${ctx.generatedText}${ctx.label ? ` · ${ctx.label}` : ""}`, { font: font(9.5, SOFT) });
  const rule = ws.getRow(5);
  rule.height = 5;
  for (let c = 2; c <= 9; c += 1) ws.getCell(5, c).border = { bottom: { style: "medium", color: { argb: argb(theme.head) } } };
  return 7;
}

/** Four large figures across the page. */
function kpiRow(ws, row, theme, cards) {
  ws.getRow(row).height = 34;
  ws.getRow(row + 1).height = 20;
  const spans = [[2, 3], [4, 5], [6, 7], [8, 9]];
  const gap = { style: "thick", color: { argb: argb(WHITE) } };
  cards.forEach((card, i) => {
    const [c1, c2] = spans[i];
    const color = card.danger ? DANGER : theme.accent;
    const bg = card.danger ? DANGER_BG : theme.tint;
    put(ws, row, c1, c2, card.value, { font: font(card.small ? 14 : 22, color, true), fill: fill(bg), align: "center", border: { left: gap, right: gap } });
    put(ws, row + 1, c1, c2, card.label, { font: font(9.5, SOFT, true), fill: fill(bg), align: "center", border: { left: gap, right: gap } });
  });
  return row + 3;
}

function insight(ws, row, theme, text) {
  ws.getRow(row).height = 52;
  put(ws, row, 2, 9, text, {
    font: font(11, INK), fill: fill(theme.tint), wrap: true,
    border: { right: { style: "thick", color: { argb: argb(theme.head) } } },
  });
  return row + 2;
}

function sectionTitle(ws, row, c1, c2, title, theme) {
  ws.getRow(row).height = 24;
  put(ws, row, c1, c2, title, { font: font(12.5, theme.accent, true), border: { bottom: { style: "medium", color: { argb: argb(theme.head) } } } });
}

function headerCells(ws, row, theme, cols) {
  ws.getRow(row).height = 22;
  for (const col of cols) {
    put(ws, row, col.c1, col.c2 ?? col.c1, col.header, { font: font(10, WHITE, true), fill: fill(theme.head), align: col.align || "center", wrap: true });
  }
}

function dataBars(ws, col, firstRow, lastRow, theme) {
  if (lastRow < firstRow) return;
  const letter = ws.getColumn(col).letter;
  ws.addConditionalFormatting({
    ref: `${letter}${firstRow}:${letter}${lastRow}`,
    rules: [{
      type: "dataBar", priority: 1, gradient: false, border: false, showValue: true, minLength: 0, maxLength: 100,
      cfvo: [{ type: "num", value: 0 }, { type: "max" }], color: { argb: argb(theme.bar) },
    }],
  });
}

/** A "name, hours, share" table; `side` picks the right or left half of the page. Returns the next free row. */
function breakdown(ws, row, side, title, rows, total, theme, nameHeader) {
  const nameEnd = side === RIGHT ? 3 : side.first;
  sectionTitle(ws, row, side.first, side.third, title, theme);
  headerCells(ws, row + 1, theme, [
    { c1: side.first, c2: nameEnd, header: nameHeader, align: "right" },
    { c1: side.second, header: "שעות" },
    { c1: side.third, header: "חלק מהסך" },
  ]);
  let r = row + 2;
  if (!rows.length) {
    put(ws, r, side.first, side.third, "אין נתונים", { font: font(10, SOFT) });
    return r + 2;
  }
  rows.forEach((item, i) => {
    const bg = i % 2 ? { fill: fill(ZEBRA) } : {};
    const border = { bottom: hairline };
    put(ws, r, side.first, nameEnd, item.name, { font: font(10), border, ...bg });
    put(ws, r, side.second, side.second, round1(item.value), { font: font(10, INK, true), align: "center", border, ...bg });
    put(ws, r, side.third, side.third, total > 0 ? item.value / total : 0, { font: font(9.5, INK), align: "center", numFmt: "0%", border, ...bg });
    ws.getRow(r).height = 18;
    r += 1;
  });
  dataBars(ws, side.third, row + 2, r - 1, theme);
  return r + 1;
}

function peopleTable(ws, row, list, staff, threshold, theme) {
  const total = sumHours(list);
  sectionTitle(ws, row, 2, 9, "דירוג אנשי הצוות", theme);
  headerCells(ws, row + 1, theme, [
    { c1: 2, header: "#" }, { c1: 3, header: "שם", align: "right" }, { c1: 4, header: "שעות" }, { c1: 5, header: "חלק מהסך" },
    { c1: 6, header: "רשומות" }, { c1: 7, header: "סיבה מובילה", align: "right" }, { c1: 8, header: "אחרונה" }, { c1: 9, header: "מצב" },
  ]);
  const first = row + 2;
  staff.forEach((p, i) => {
    const r = first + i;
    const over = p.hours >= threshold;
    const base = { border: { bottom: hairline }, ...(i % 2 ? { fill: fill(ZEBRA) } : {}) };
    put(ws, r, 2, 2, i + 1, { ...base, font: font(9.5, SOFT), align: "center" });
    put(ws, r, 3, 3, p.name, { ...base, font: font(10, INK, true) });
    put(ws, r, 4, 4, round1(p.hours), { ...base, font: font(10.5, theme.accent, true), align: "center" });
    put(ws, r, 5, 5, total > 0 ? p.hours / total : 0, { ...base, font: font(9.5), align: "center", numFmt: "0.0%" });
    put(ws, r, 6, 6, p.count, { ...base, font: font(10), align: "center" });
    put(ws, r, 7, 7, p.topReason, { ...base, font: font(10) });
    put(ws, r, 8, 8, dateCell(p.last), { ...base, font: font(9.5), align: "center", numFmt: "dd/mm/yy" });
    put(ws, r, 9, 9, over ? "מעל הסף" : "תקין", {
      border: base.border, font: font(9.5, over ? DANGER : OK, true), fill: fill(over ? DANGER_BG : OK_BG), align: "center",
    });
    ws.getRow(r).height = 19;
  });
  dataBars(ws, 5, first, first + staff.length - 1, theme);
  return first + staff.length + 1;
}

function monthRows(list) {
  return monthsSpan(list).map((k) => {
    const inMonth = list.filter((e) => monthKey(e.date) === k);
    return { name: monthKeyLabel(k), value: sumHours(inMonth), count: inMonth.length };
  });
}

/** The few sentences at the top of each report. */
function story(list, staff, pop, threshold) {
  const total = sumHours(list);
  const reasons = groupHours(list, (e) => e.reason);
  const busiest = monthRows(list).slice().sort((a, b) => b.value - a.value)[0];
  const over = staff.filter((p) => p.hours >= threshold).length;
  const parts = [`בתקופה זו נרשמו ${fmt(total)} שעות שאבדו אצל ${staff.length} ${pop.plural}, ב-${list.length} רשומות.`];
  if (reasons[0]) parts.push(`הסיבה המובילה היא ${reasons[0].name} (${Math.round((reasons[0].value / total) * 100)} אחוז מהשעות).`);
  if (busiest) parts.push(`החודש העמוס ביותר: ${busiest.name}, עם ${fmt(busiest.value)} שעות.`);
  parts.push(over ? `${over} מתוך ${staff.length} חצו את סף ${threshold} השעות.` : `אף אחד לא חצה את סף ${threshold} השעות.`);
  return parts.join(" ");
}

function addPopulationReport(wb, pop, list, ctx) {
  const { theme } = pop;
  const ws = newSheet(wb, pop.report, theme, REPORT_WIDTHS);
  let row = reportHeader(ws, ctx, theme, `דוח שעות שאבדו - ${pop.plural}`);
  if (!list.length) {
    put(ws, row, 2, 9, `אין רשומות של ${pop.plural} ${ctx.partial ? "בתקופה זו" : "בגיבוי זה"}.`, { font: font(12, SOFT) });
    return;
  }
  const staff = people(list);
  const total = sumHours(list);
  const over = staff.filter((p) => p.hours >= ctx.threshold).length;
  row = kpiRow(ws, row, theme, [
    { value: round1(total), label: 'סה"כ שעות שאבדו' },
    { value: staff.length, label: `${pop.plural} עם היעדרות` },
    { value: round1(total / staff.length), label: "ממוצע שעות לאיש צוות" },
    { value: over, label: `מעל סף ${ctx.threshold} שעות`, danger: over > 0 },
  ]);
  row = insight(ws, row, theme, story(list, staff, pop, ctx.threshold));
  row = peopleTable(ws, row, list, staff, ctx.threshold, theme);

  const pair = (a, b) => {
    const start = row;
    const endA = breakdown(ws, start, RIGHT, a.title, a.rows, total, theme, a.column);
    const endB = breakdown(ws, start, LEFT, b.title, b.rows, total, theme, b.column);
    row = Math.max(endA, endB);
  };
  pair(
    { title: "לפי סיבה", column: "סיבה", rows: groupHours(list, (e) => e.reason) },
    { title: "לפי חודש", column: "חודש", rows: monthRows(list) },
  );
  pair(
    { title: "לפי מקצוע", column: "מקצוע", rows: groupHours(list, (e) => e.subject) },
    { title: "לפי כיתה", column: "כיתה", rows: byClass(list) },
  );
  breakdown(ws, row, RIGHT, "לפי יום בשבוע", byWeekday(list), total, theme, "יום");
}

function addRecords(wb, pop, list, ctx) {
  const { theme } = pop;
  const ws = newSheet(wb, pop.records, theme, RECORD_COLUMNS.map((c) => c.width), true);
  const last = RECORDS_HEADER_ROW + list.length;
  const hoursCol = "H";
  ws.getRow(1).height = 30;
  put(ws, 1, 1, 10, `רשומות - ${pop.plural}`, { font: font(17, theme.accent, true) });
  put(ws, 2, 1, 10, `${SCHOOL} · ${ctx.periodText} · הופק ב-${ctx.generatedText}`, { font: font(9.5, SOFT) });

  // Live totals: they follow the filters the reader applies to the table.
  ws.getRow(3).height = 22;
  const strip = { fill: fill(theme.tint) };
  put(ws, 3, 1, 1, "רשומות מוצגות", { ...strip, font: font(10, SOFT, true) });
  put(ws, 3, 2, 2, list.length ? { formula: `SUBTOTAL(103,A${RECORDS_HEADER_ROW + 1}:A${last})`, result: list.length } : 0, { ...strip, font: font(12, theme.accent, true) });
  put(ws, 3, 3, 5, 'סה"כ שעות מוצגות', { ...strip, font: font(10, SOFT, true) });
  put(ws, 3, 6, 6, list.length ? { formula: `SUBTOTAL(109,${hoursCol}${RECORDS_HEADER_ROW + 1}:${hoursCol}${last})`, result: round1(sumHours(list)) } : 0, { ...strip, font: font(12, theme.accent, true) });
  put(ws, 3, 7, 10, "", strip);

  ws.getRow(4).height = 6;
  headerCells(ws, RECORDS_HEADER_ROW, theme, RECORD_COLUMNS.map((c, i) => ({ c1: i + 1, header: c.header })));

  const sorted = list.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.name || "").localeCompare(b.name || "", "he"));
  sorted.forEach((e, i) => {
    const r = RECORDS_HEADER_ROW + 1 + i;
    const dayIndex = weekdayIndex(e.date);
    const day = dayIndex >= 0 ? DAY_NAMES[dayIndex] : "";
    const monthIndex = dayIndex >= 0 ? Number(e.date.slice(5, 7)) - 1 : -1;
    const dayColor = DAY_COLORS[day];
    const monthColor = MONTH_COLORS[monthIndex];
    const base = { border: { bottom: hairline }, ...(i % 2 ? { fill: fill(ZEBRA) } : {}) };
    const center = { ...base, align: "center", font: font(10) };
    const badge = (c) => ({
      border: base.border, align: "center", font: font(9.5, c ? c.fg.slice(1) : INK, true), ...(c ? { fill: fill(c.bg.slice(1)) } : base),
    });
    put(ws, r, 1, 1, e.name ?? "", { ...base, font: font(10, INK, true) });
    put(ws, r, 2, 2, e.subject ?? "", { ...base, font: font(10) });
    put(ws, r, 3, 3, e.grade ?? "", center);
    put(ws, r, 4, 4, e.parallel ?? "", center);
    put(ws, r, 5, 5, dateCell(e.date), { ...center, numFmt: "dd/mm/yyyy" });
    put(ws, r, 6, 6, day, badge(dayColor));
    put(ws, r, 7, 7, monthIndex >= 0 ? MONTH_NAMES[monthIndex] : "", badge(monthColor));
    put(ws, r, 8, 8, hoursOf(e), { ...center, font: font(10.5, theme.accent, true) });
    put(ws, r, 9, 9, e.reason ?? "", { ...base, font: font(10) });
    put(ws, r, 10, 10, e.comment ?? "", { ...base, font: font(9.5, SOFT), wrap: true });
  });

  ws.views = [{ rightToLeft: true, showGridLines: false, state: "frozen", ySplit: RECORDS_HEADER_ROW }];
  ws.pageSetup.printTitlesRow = `${RECORDS_HEADER_ROW}:${RECORDS_HEADER_ROW}`;
  if (list.length) ws.autoFilter = { from: { row: RECORDS_HEADER_ROW, column: 1 }, to: { row: last, column: 10 } };
}

function addSummary(wb, teachers, instructors, ctx) {
  const theme = THEMES.summary;
  const ws = newSheet(wb, "סיכום", theme, REPORT_WIDTHS);
  const all = [...teachers, ...instructors];
  const total = sumHours(all);
  const tStaff = people(teachers);
  const iStaff = people(instructors);
  const staffCount = tStaff.length + iStaff.length;
  const overOf = (staff) => staff.filter((p) => p.hours >= ctx.threshold).length;
  const over = overOf(tStaff) + overOf(iStaff);

  let row = reportHeader(ws, ctx, theme, ctx.partial ? "דו\"ח איבוד שעות - סיכום" : "גיבוי דו\"ח איבוד שעות - סיכום");
  row = kpiRow(ws, row, theme, [
    { value: round1(total), label: 'סה"כ שעות שאבדו' },
    { value: all.length, label: "רשומות" },
    { value: staffCount, label: "אנשי צוות עם היעדרות" },
    { value: over, label: `מעל סף ${ctx.threshold} שעות`, danger: over > 0 },
  ]);

  sectionTitle(ws, row, 2, 9, "מורים מול מדריכים", theme);
  headerCells(ws, row + 1, theme, [
    { c1: 2, c2: 3, header: "מדד", align: "right" },
    { c1: 4, c2: 5, header: "מורים" }, { c1: 6, c2: 7, header: "מדריכים" }, { c1: 8, c2: 9, header: 'סה"כ' },
  ]);
  const topReason = (list) => groupHours(list, (e) => e.reason)[0]?.name || "—";
  const average = (hours, count) => (count ? round1(hours / count) : 0);
  const tHours = sumHours(teachers);
  const iHours = sumHours(instructors);
  const rows = [
    ["שעות שאבדו", round1(tHours), round1(iHours), round1(total)],
    ["חלק מכלל השעות", total ? tHours / total : 0, total ? iHours / total : 0, total ? 1 : 0],
    ["אנשי צוות עם היעדרות", tStaff.length, iStaff.length, staffCount],
    ["רשומות", teachers.length, instructors.length, all.length],
    ["ממוצע שעות לאיש צוות", average(tHours, tStaff.length), average(iHours, iStaff.length), average(total, staffCount)],
    [`מעל סף ${ctx.threshold} שעות`, overOf(tStaff), overOf(iStaff), over],
    ["סיבה מובילה", topReason(teachers), topReason(instructors), topReason(all)],
  ];
  rows.forEach((values, i) => {
    const r = row + 2 + i;
    const base = { border: { bottom: hairline }, ...(i % 2 ? { fill: fill(ZEBRA) } : {}) };
    const numFmt = i === 1 ? "0%" : undefined;
    ws.getRow(r).height = 19;
    put(ws, r, 2, 3, values[0], { ...base, font: font(10, INK, true) });
    put(ws, r, 4, 5, values[1], { ...base, font: font(10.5, THEMES.teachers.accent, true), align: "center", numFmt });
    put(ws, r, 6, 7, values[2], { ...base, font: font(10.5, THEMES.instructors.accent, true), align: "center", numFmt });
    put(ws, r, 8, 9, values[3], { ...base, font: font(10.5, NAVY, true), align: "center", numFmt });
  });
  row += rows.length + 3;

  const topPeople = (staff) => staff.slice(0, 5).map((p) => ({ name: p.name, value: p.hours }));
  const endA = breakdown(ws, row, RIGHT, "מגמה חודשית", monthRows(all), total, theme, "חודש");
  const endB = breakdown(ws, row, LEFT, "סיבות מובילות", groupHours(all, (e) => e.reason).slice(0, 8), total, theme, "סיבה");
  row = Math.max(endA, endB);
  const endC = breakdown(ws, row, RIGHT, "חמשת המורים המובילים", topPeople(tStaff), tHours, THEMES.teachers, "שם");
  const endD = breakdown(ws, row, LEFT, "חמשת המדריכים המובילים", topPeople(iStaff), iHours, THEMES.instructors, "שם");
  row = Math.max(endC, endD);

  sectionTitle(ws, row, 2, 9, "מה יש בקובץ", theme);
  const contents = [
    [POPULATIONS.teachers.report, "דירוג, סיבות, חודשים, מקצועות, כיתות וימים"],
    [POPULATIONS.teachers.records, "כל הרשומות, עם סינון ומיון"],
    [POPULATIONS.instructors.report, "דירוג, סיבות, חודשים, מקצועות, כיתות וימים"],
    [POPULATIONS.instructors.records, "כל הרשומות, עם סינון ומיון"],
  ];
  contents.forEach(([sheet, text], i) => {
    const r = row + 1 + i;
    put(ws, r, 2, 3, { text: sheet, hyperlink: `#'${sheet}'!A1` }, { font: { ...font(10, "2E6DA4", true), underline: true } });
    put(ws, r, 4, 9, text, { font: font(10, SOFT) });
  });
  put(ws, row + contents.length + 2, 2, 9, 'לשחזור: בלשוניות "הזנת מורים" ו"הזנת מדריכים" בוחרים "ייבוא" וטוענים קובץ זה.', { font: font(9.5, SOFT) });
}

async function loadLogo(wb) {
  try {
    const res = await fetch("/logo.png");
    if (!res.ok) return null;
    return wb.addImage({ buffer: await res.arrayBuffer(), extension: "png" });
  } catch {
    return null; // The report is complete without the logo.
  }
}

function periodText(entries) {
  const dates = entries.map((e) => e.date).filter(Boolean).sort();
  return dates.length ? `תקופה: ${dateText(dates[0])} - ${dateText(dates[dates.length - 1])}` : "ללא רשומות";
}

/** Builds the workbook and returns its bytes. `label` names an archive when exporting one; `period` names a chosen date range. */
export async function buildBackupWorkbook({ teacherEntries, instructorEntries, alertThreshold, label = "", period = "", now = new Date(), logo = true }) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "צוות תפעול הדרכה";
  wb.created = now;
  wb.views = [{ activeTab: 0, firstSheet: 0 }];

  const ctx = {
    label,
    partial: Boolean(period),
    threshold: alertThreshold,
    periodText: period ? `תקופה: ${period}` : periodText([...teacherEntries, ...instructorEntries]),
    generatedText: dateText(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`),
    logoId: logo ? await loadLogo(wb) : null,
  };
  addSummary(wb, teacherEntries, instructorEntries, ctx);
  addPopulationReport(wb, POPULATIONS.teachers, teacherEntries, ctx);
  addRecords(wb, POPULATIONS.teachers, teacherEntries, ctx);
  addPopulationReport(wb, POPULATIONS.instructors, instructorEntries, ctx);
  addRecords(wb, POPULATIONS.instructors, instructorEntries, ctx);
  return wb.xlsx.writeBuffer();
}

/** Builds the workbook and hands it to the browser as a download. */
export async function downloadBackup({ filename, ...report }) {
  const bytes = await buildBackupWorkbook(report);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
