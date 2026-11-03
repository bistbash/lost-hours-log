import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { fmt, matchNames, pct, rangePresets } from "../lib/stats.js";

/**
 * Searchable name picker (combobox). Type any part of a name (first or last, without quotes), move with
 * the arrow keys, Enter to choose. `meta` (name -> text) is shown next to each option, e.g. hours lost.
 */
export function NamePicker({ value, onChange, options, placeholder = "הקלידו לחיפוש שם…", emptyLabel, meta, label, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const id = useId();

  const matches = useMemo(() => matchNames(options, query), [options, query]);
  const items = useMemo(() => (emptyLabel && !query ? [{ value: "", label: emptyLabel }] : []).concat(matches.map((n) => ({ value: n, label: n }))), [emptyLabel, matches, query]);

  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${active}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (item) => {
    onChange(item.value);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { if (open && items[active]) { e.preventDefault(); choose(items[active]); } }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
    else if (e.key === "PageDown") { e.preventDefault(); setActive((a) => Math.min(a + 8, items.length - 1)); }
    else if (e.key === "PageUp") { e.preventDefault(); setActive((a) => Math.max(a - 8, 0)); }
  };

  return (
    <div className="thc-picker">
      <div className="thc-picker-box">
        <Search size={15} className="thc-picker-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined}
          aria-label={label || placeholder}
          autoFocus={autoFocus}
          value={open ? query : value || ""}
          placeholder={value ? value : emptyLabel || placeholder}
          onFocus={() => { setOpen(true); setQuery(""); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        {value && emptyLabel && (
          <button type="button" className="thc-picker-clear" aria-label="ניקוי" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange("")}>
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <ul className="thc-picker-list" id={`${id}-list`} role="listbox" ref={listRef}>
          {items.length === 0 && <li className="thc-picker-none">לא נמצא שם שמתאים ל-"{query}"</li>}
          {items.map((it, i) => (
            <li
              key={it.value || "__all"}
              id={`${id}-${i}`}
              data-idx={i}
              role="option"
              aria-selected={it.value === value}
              className={`thc-picker-option${i === active ? " is-active" : ""}${it.value === value ? " is-selected" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(it)}
            >
              <span>{it.label}</span>
              {meta && it.value && meta[it.value] != null && <span className="thc-picker-meta">{meta[it.value]}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** From / to dates with quick presets. */
export function RangeBar({ from, to, onChange }) {
  const presets = useMemo(() => rangePresets(), []);
  const activeId = presets.find((p) => p.from === from && p.to === to)?.id;
  return (
    <div className="thc-range">
      <div className="thc-seg thc-range-presets">
        {presets.map((p) => (
          <button key={p.id} type="button" className={activeId === p.id ? "active" : ""} onClick={() => onChange(p.from, p.to)}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="thc-range-date">
        <span>מ-</span>
        <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
      </label>
      <label className="thc-range-date">
        <span>עד</span>
        <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
      </label>
    </div>
  );
}

/**
 * Horizontal bars, largest first. rows: [{ name, value, count? }]. Shows the top `limit` with a toggle,
 * values as hours or as a share of `total`; rows are clickable when `onPick` is given.
 */
export function BarList({ rows, total, limit = 10, mode = "hours", onPick, fill, unit = "" }) {
  const [all, setAll] = useState(false);
  const max = rows[0]?.value || 1;
  const visible = all ? rows : rows.slice(0, limit);
  if (!rows.length) return <p className="thc-empty">אין נתונים בטווח שנבחר.</p>;
  return (
    <div>
      <div className="thc-barlist">
        {visible.map((d) => {
          const Label = onPick ? "button" : "span";
          return (
            <div key={d.name} className="thc-barlist-row">
              <Label
                className={`thc-barlist-label${onPick ? " thc-link" : ""}`}
                title={d.name}
                {...(onPick ? { type: "button", onClick: () => onPick(d.name) } : {})}
              >
                {d.name}
              </Label>
              <div className="thc-barlist-track" title={`${d.name}: ${fmt(d.value)} שעות${d.count ? ` · ${d.count} רשומות` : ""}`}>
                <div className="thc-barlist-fill" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, ...(fill ? { background: fill } : {}) }} />
              </div>
              <span className="thc-barlist-value">{mode === "percent" ? pct(d.value, total) : `${fmt(d.value)}${unit}`}</span>
            </div>
          );
        })}
      </div>
      {rows.length > limit && (
        <button type="button" className="thc-ghost-btn thc-more-btn" onClick={() => setAll((a) => !a)}>
          {all ? `הצג רק ${limit} מובילים` : `הצג את כל ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** KPI tile. */
export function Kpi({ label, value, sub, danger }) {
  return (
    <div className={`thc-stat-card${danger ? " thc-stat-card-danger" : ""}`}>
      <span className="thc-stat-label">{label}</span>
      <span className="thc-stat-value">{value}</span>
      {sub && <span className="thc-kpi-sub">{sub}</span>}
    </div>
  );
}

export const tooltipStyle = { fontFamily: "Assistant", direction: "rtl", borderRadius: 8, border: "1px solid #D8DDD6" };
export const axisTick = { fontFamily: "Assistant", fontSize: 12.5, fontWeight: 600, fill: "#3A4750" };
export const numTick = { fontFamily: "Roboto Mono", fontSize: 11, fill: "#55605C" };
