import { memo } from "react";

import { t } from "@/lib/i18n";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const buttonClass =
  "px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 " +
  "rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none";

/**
 * Page navigation for the book and catalog lists.
 *
 * Deliberately replaces the visible page rather than appending to it: an
 * ever-growing list keeps every card already seen mounted, and scrolling and
 * typing get slower the longer the list is used.
 */
function PaginationControls({
  page,
  totalPages,
  onPageChange,
}: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center items-center gap-4 mt-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        data-cy="pagination_prev_page"
        className={buttonClass}
      >
        {t("pagination.previousPage")}
      </button>
      <span
        className="text-sm text-muted-foreground"
        data-cy="pagination_indicator"
      >
        {t("pagination.pageIndicator", {
          page: String(page),
          total: String(totalPages),
        })}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        data-cy="pagination_next_page"
        className={buttonClass}
      >
        {t("pagination.nextPage")}
      </button>
    </div>
  );
}

export default memo(PaginationControls);
