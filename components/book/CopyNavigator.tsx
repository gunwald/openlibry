import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { CopySiblings } from "@/entities/book";
import { t } from "@/lib/i18n";

interface CopyNavigatorProps {
  copies: CopySiblings | null;
  /** Where a sibling lives: "/catalog" for visitors, "/book" for staff. */
  basePath: string;
  /** Staff need the volume's own number to put a hand on it. */
  showId?: boolean;
  bookId?: number;
}

const arrow =
  "flex items-center justify-center h-7 w-7 rounded-full border border-border " +
  "text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground " +
  "aria-disabled:opacity-30 aria-disabled:pointer-events-none";

/**
 * Steps between the copies of one title.
 *
 * The lists group copies into a single row, so without this a title with
 * thirty-five copies opened onto one of them and the rest were unreachable.
 * Deliberately one line whatever the count: a chip per copy would be a wall on
 * exactly the titles that need this most.
 */
export default function CopyNavigator({
  copies,
  basePath,
  showId = false,
  bookId,
}: CopyNavigatorProps) {
  // A single copy has nothing to step through, and saying "1 von 1" is noise.
  if (!copies) return null;

  const { position, total, availableCount, previousId, nextId } = copies;

  return (
    <nav
      className="flex items-center gap-3 text-sm text-muted-foreground"
      aria-label={t("copies.label")}
      data-cy="copy_navigator"
    >
      {previousId === null ? (
        <span className={arrow} aria-disabled="true" aria-hidden="true">
          <ChevronLeft className="h-4 w-4" />
        </span>
      ) : (
        <Link
          href={`${basePath}/${previousId}`}
          aria-label={t("copies.previous")}
          data-cy="copy_prev"
          className={arrow}
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
      )}

      <span data-cy="copy_position">
        {t("copies.position", {
          position: String(position),
          total: String(total),
        })}
        {showId && bookId !== undefined && (
          <span className="ml-1 text-foreground/70">#{bookId}</span>
        )}
        <span className="mx-2 opacity-50">&middot;</span>
        {t("copies.available", { count: String(availableCount) })}
      </span>

      {nextId === null ? (
        <span className={arrow} aria-disabled="true" aria-hidden="true">
          <ChevronRight className="h-4 w-4" />
        </span>
      ) : (
        <Link
          href={`${basePath}/${nextId}`}
          aria-label={t("copies.next")}
          data-cy="copy_next"
          className={arrow}
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </nav>
  );
}
