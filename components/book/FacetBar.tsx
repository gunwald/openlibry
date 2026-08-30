import { memo, useCallback, useEffect, useRef, useState } from "react";

import { TopicFacet } from "@/entities/book";
import { t } from "@/lib/i18n";

interface FacetBarProps {
  facets: TopicFacet[];
  selected: string[];
  onToggle: (topic: string) => void;
}

/** Only a few pills fit on one row; measuring beyond this cannot change it. */
const MEASURE_LIMIT = 20;

const pillBase =
  "inline-flex items-center gap-1.5 shrink-0 h-7 px-3 rounded-full " +
  "text-xs font-medium border transition-colors duration-150 cursor-pointer";
const pillIdle =
  "bg-background text-foreground/80 border-border hover:bg-primary/10 hover:text-foreground";
const pillActive =
  "bg-primary text-primary-foreground border-primary hover:bg-primary/90";

/**
 * Topic filters under the search field.
 *
 * Shows the most common topics first and folds whatever does not fit on one
 * row behind a "more" button, so the row never wraps and never pushes the
 * results down the page. Selected topics are pulled to the front so they stay
 * visible once the rest is folded away.
 *
 * How many fit is measured rather than guessed: the pill widths depend on the
 * words, which depend on the library.
 */
function FacetBar({ facets, selected, onToggle }: FacetBarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(facets.length);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");

  // Selected first, so a chosen topic never disappears into the folded tail.
  const ordered = [
    ...facets.filter((f) => selected.includes(f.topic)),
    ...facets.filter((f) => !selected.includes(f.topic)),
  ];

  const measure = useCallback(() => {
    const row = rowRef.current;
    const shadow = measureRef.current;
    if (!row || !shadow) return;

    const available = row.clientWidth;
    // Keep room for the "more" button; its width is roughly a short pill.
    const reserve = 96;
    let used = 0;
    let fits = 0;
    for (const child of Array.from(shadow.children) as HTMLElement[]) {
      const w = child.offsetWidth + 6; // pill plus gap
      if (used + w > available - reserve) break;
      used += w;
      fits++;
    }
    setVisibleCount(Math.max(1, fits));
  }, []);

  useEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [measure, facets]);

  if (facets.length === 0) return null;

  const shown = ordered.slice(0, visibleCount);
  const hidden = ordered.length - shown.length;
  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? ordered.filter((f) => f.topic.toLowerCase().includes(needle))
    : ordered;

  return (
    <div className="px-4 md:px-10 -mt-3 mb-4" data-cy="facet_bar">
      {/* Off-screen copy used only to measure pill widths. Capped: only a
          handful ever fit on one row, so measuring the whole tail would be
          dozens of laid-out nodes for nothing. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="absolute -left-[9999px] top-0 flex gap-1.5 pointer-events-none"
      >
        {ordered.slice(0, MEASURE_LIMIT).map((f) => (
          <span key={f.topic} className={`${pillBase} ${pillIdle}`}>
            {f.topic}
            <span className="opacity-60">{f.count}</span>
          </span>
        ))}
      </div>

      <div
        ref={rowRef}
        className="flex gap-1.5 overflow-hidden"
        role="group"
        aria-label={t("facets.label")}
      >
        {shown.map((f) => {
          const isOn = selected.includes(f.topic);
          return (
            <button
              key={f.topic}
              type="button"
              onClick={() => onToggle(f.topic)}
              aria-pressed={isOn}
              data-cy={`facet_${isOn ? "active" : "idle"}`}
              className={`${pillBase} ${isOn ? pillActive : pillIdle}`}
            >
              {f.topic}
              <span className={isOn ? "opacity-80" : "opacity-60"}>
                {isOn ? "×" : f.count}
              </span>
            </button>
          );
        })}

        {(hidden > 0 || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            data-cy="facet_more"
            className={`${pillBase} ${pillIdle} uppercase tracking-wide`}
          >
            {expanded
              ? t("facets.less")
              : t("facets.more", { count: String(hidden) })}
          </button>
        )}
      </div>

      {/* The tail lives in a bounded, searchable panel rather than an
          ever-taller block of pills: a library may have hundreds of topics,
          and expanding must not push the results off the screen. */}
      {expanded && (
        <div
          className="mt-2 p-2 rounded-lg border border-border bg-background/95"
          data-cy="facet_panel"
        >
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("facets.filterPlaceholder")}
            aria-label={t("facets.filterPlaceholder")}
            data-cy="facet_filter"
            className="w-full mb-2 px-2 py-1 rounded-md border border-border
                       bg-background text-sm outline-none
                       focus-visible:border-primary"
          />
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
            {matching.length === 0 && (
              <span className="text-xs text-muted-foreground px-1 py-1">
                {t("facets.noMatch")}
              </span>
            )}
            {matching.map((f) => {
              const isOn = selected.includes(f.topic);
              return (
                <button
                  key={f.topic}
                  type="button"
                  onClick={() => onToggle(f.topic)}
                  aria-pressed={isOn}
                  data-cy={`facet_panel_${isOn ? "active" : "idle"}`}
                  className={`${pillBase} ${isOn ? pillActive : pillIdle}`}
                >
                  {f.topic}
                  <span className={isOn ? "opacity-80" : "opacity-60"}>
                    {isOn ? "×" : f.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(FacetBar);
