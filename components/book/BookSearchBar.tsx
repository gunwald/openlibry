import { Grid2x2, LayoutList, ListPlus, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TopicFacet } from "@/entities/book";
import { t } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";

interface BookSearchBarProps {
  handleInputChange: React.ChangeEventHandler<
    HTMLTextAreaElement | HTMLInputElement
  >;
  handleNewBook: React.MouseEventHandler<HTMLButtonElement>;
  bookSearchInput: string;
  toggleView: React.MouseEventHandler<HTMLButtonElement>;
  detailView: boolean;
  searchResultNumber: number;
  showNewBookControl?: boolean;
  showViewToggle?: boolean;
  /** Topics offered as suggestions while typing. Omit to disable the menu. */
  facets?: TopicFacet[];
  selectedTopics?: string[];
  onToggleTopic?: (topic: string) => void;
}

/** Topic suggestions shown at once; more than this is a list, not a hint. */
const MAX_SUGGESTIONS = 6;

export default function BookSearchBar({
  handleInputChange,
  handleNewBook,
  bookSearchInput,
  toggleView,
  detailView,
  searchResultNumber,
  showNewBookControl = true,
  showViewToggle = true,
  facets = [],
  selectedTopics = [],
  onToggleTopic,
}: BookSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  // Topics matching what has been typed. This is why there is no second
  // search box: the field already in front of the user does both jobs.
  const suggestions = useMemo(() => {
    const needle = bookSearchInput.trim().toLowerCase();
    if (!needle || !onToggleTopic) return [];
    return facets
      .filter(
        (f) =>
          !selectedTopics.includes(f.topic) &&
          f.topic.toLowerCase().includes(needle),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [bookSearchInput, facets, selectedTopics, onToggleTopic]);

  // Close when the focus or the pointer leaves the search area.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!formRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(suggestions.length > 0);
  }, [suggestions.length, bookSearchInput]);
  useEffect(() => {
    inputRef.current?.focus();

    // Next's Pages Router moves focus to <body> after route changes
    // complete (for a11y announcements) — re-claim it afterwards.
    const refocus = () => inputRef.current?.focus();
    router.events.on("routeChangeComplete", refocus);
    return () => router.events.off("routeChangeComplete", refocus);
  }, [router.events]);

  return (
    <TooltipProvider>
      <div className="flex justify-center px-4 md:px-10 my-6">
        <div className="flex w-full max-w-xl items-center gap-2">
          {/* ── Search input ────────────────────────────────────── */}
          <form
            ref={formRef}
            onSubmit={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMenuOpen(false);
            }}
            className="relative flex flex-1 items-center"
          >
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={bookSearchInput}
              onChange={handleInputChange}
              placeholder={t("bookSearchBar.placeholder")}
              aria-label={t("bookSearchBar.ariaLabel")}
              data-cy="rental_input_searchbook"
              className="h-10 w-full rounded-lg border border-border bg-card/90
                         pl-9 pr-3 text-sm text-foreground
                         placeholder:text-muted-foreground
                         backdrop-blur-xl
                         shadow-sm
                         transition-all duration-200
                         hover:border-primary/25 hover:shadow-md
                         focus:border-primary focus:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/20"
            />

            {/* Result count — inside the input, right-aligned */}
            {searchResultNumber > 0 && (
              <Badge
                variant="secondary"
                className="absolute right-2 text-[0.65rem] px-1.5 py-0 h-5 font-medium pointer-events-none"
              >
                {searchResultNumber}
              </Badge>
            )}

            {/* Topic suggestions for what has been typed. Picking one turns
                the text into a filter and empties the field, so the two never
                fight over the same words. */}
            {menuOpen && suggestions.length > 0 && (
              <div
                className="absolute top-11 left-0 right-0 z-50 py-1
                           rounded-lg border border-border bg-card shadow-lg"
                role="listbox"
                data-cy="search_suggestions"
              >
                <div className="px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("facets.label")}
                </div>
                {suggestions.map((f) => (
                  <button
                    key={f.topic}
                    type="button"
                    role="option"
                    aria-selected={false}
                    data-cy="search_suggestion"
                    onClick={() => {
                      onToggleTopic?.(f.topic);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3
                               px-3 py-1.5 text-sm text-left
                               hover:bg-primary/10 focus-visible:bg-primary/10
                               focus-visible:outline-none"
                  >
                    <span className="truncate">{f.topic}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {f.count}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* ── Action buttons ──────────────────────────────────── */}
          <div className="flex items-center gap-1 shrink-0">
            {/* View toggle — hidden on public catalog (card-only view) */}
            {showViewToggle && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleView}
                    aria-label={t("bookSearchBar.toggleView")}
                    className="flex items-center justify-center
                               h-10 w-10 rounded-lg border border-border bg-card/90
                               text-muted-foreground
                               shadow-sm backdrop-blur-xl
                               transition-all duration-200
                               hover:border-primary/25 hover:text-primary hover:shadow-md
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    {detailView ? (
                      <LayoutList className="h-4 w-4" />
                    ) : (
                      <Grid2x2 className="h-4 w-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("bookSearchBar.toggleView")}</TooltipContent>
              </Tooltip>
            )}

            {showNewBookControl && (
              <>
                {/* Vertical separator */}
                <div className="h-6 w-px bg-border mx-0.5" />

                {/* New book */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleNewBook}
                      aria-label={t("bookSearchBar.newBook")}
                      data-cy="create_book_button"
                      className="flex items-center justify-center
                                 h-10 w-10 rounded-lg
                                 bg-primary text-primary-foreground
                                 shadow-sm
                                 transition-all duration-200
                                 hover:bg-primary/90 hover:shadow-md hover:scale-105
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("bookSearchBar.newBook")}</TooltipContent>
                </Tooltip>

                {/* Batch scan */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/book/batchscan"
                      aria-label={t("bookSearchBar.importMany")}
                      data-cy="batchscan_button"
                      className="flex items-center justify-center
                                 h-10 w-10 rounded-lg border border-border bg-card/90
                                 text-muted-foreground
                                 shadow-sm backdrop-blur-xl
                                 transition-all duration-200
                                 hover:border-primary/25 hover:text-primary hover:shadow-md
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                    >
                      <ListPlus className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("bookSearchBar.importMany")}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
