import { memo, useCallback, useEffect, useRef, useState } from "react";

import { TopicFacet } from "@/entities/book";
import { t } from "@/lib/i18n";

interface FacetBarProps {
  facets: TopicFacet[];
  selected: string[];
  onToggle: (topic: string) => void;
}

/**
 * A short row of the most common topics under the search field.
 *
 * Deliberately restrained: this is a hint that filtering by topic exists, not
 * the way to reach every topic. A library has far more topics than fit on a
 * row, so the rest are found by typing in the search field, which offers them
 * as suggestions. Selected topics are pulled to the front so they stay
 * visible and removable however many are shown.
 */
const MAX_PILLS = 5;

/** Only a few pills fit on one row; measuring beyond this cannot change it. */
const MEASURE_LIMIT = 12;

const pillBase =
  "inline-flex items-center gap-1.5 shrink-0 h-7 px-3 rounded-full " +
  "text-xs font-medium border transition-colors duration-150 cursor-pointer";
const pillIdle =
  "bg-background text-foreground/80 border-border hover:bg-primary/10 hover:text-foreground";
const pillActive =
  "bg-primary text-primary-foreground border-primary hover:bg-primary/90";

function FacetBar({ facets, selected, onToggle }: FacetBarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(MAX_PILLS);

  // A selected topic stays on the row even when the current filter leaves it
  // with no books: it was derived from the counts alone, so narrowing to an
  // empty combination made the pill that caused it disappear, and there was
  // nothing left to click to undo it.
  const counted = new Map(facets.map((f) => [f.topic, f.count]));
  const active = selected.map((topic) => ({
    topic,
    count: counted.get(topic) ?? 0,
  }));
  const rest = facets.filter((f) => !selected.includes(f.topic));
  const ordered = [...active, ...rest];

  // How many fit depends on the words, which depend on the library, so it is
  // measured rather than guessed. Never more than MAX_PILLS either way.
  const measure = useCallback(() => {
    const row = rowRef.current;
    const shadow = measureRef.current;
    if (!row || !shadow) return;
    const available = row.clientWidth;
    let used = 0;
    let fits = 0;
    // Measured against a full off-screen copy rather than the visible row.
    // Measuring the row itself only ever saw the pills already being shown, so
    // widening the window could never bring a hidden one back.
    for (const child of Array.from(shadow.children) as HTMLElement[]) {
      used += child.offsetWidth + 6;
      if (used > available) break;
      fits++;
    }
    setVisibleCount(Math.max(1, Math.min(fits, MAX_PILLS)));
  }, []);

  useEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [measure, facets, selected]);

  // Not `facets.length === 0`: a filter that matches nothing returns no facets,
  // and bailing here took the active pills away with them — leaving the filter
  // on with no way to switch it off but the browser's back button.
  if (facets.length === 0 && active.length === 0) return null;

  // Selected topics are always shown, even past the cap, so a filter can
  // always be seen and switched off.
  const shown = [
    ...active,
    ...rest.slice(0, Math.max(0, visibleCount - active.length)),
  ];

  return (
    <div className="relative flex justify-center px-4 md:px-10 -mt-3 mb-4">
      {/* Off-screen copy at full width, measured instead of the visible row so
          widening the window can bring a hidden pill back. */}
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
        // Wraps rather than clipping: selected pills are always rendered, and
        // a row that cannot show them all should grow instead of hiding the
        // control that undoes the filter.
        className="flex w-full max-w-xl gap-1.5 flex-wrap"
        role="group"
        aria-label={t("facets.label")}
        data-cy="facet_bar"
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
      </div>
    </div>
  );
}

export default memo(FacetBar);
