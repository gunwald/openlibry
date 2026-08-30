import { ArrowLeftFromLine } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { memo, useCallback, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BookType } from "@/entities/BookType";
import { t } from "@/lib/i18n";
import CoverModal from "./CoverModal";
import StatusBadge from "./StatusBadge";

// =============================================================================
// Constants
// =============================================================================

const CARD_WIDTH = 200;
const CARD_HEIGHT = 290;

// =============================================================================
// Helper Functions
// =============================================================================

/** Parse semicolon-separated topics string into array */

// =============================================================================
// Main Component
// =============================================================================

interface BookSummaryCardProps {
  book: BookType;
  returnBook: React.MouseEventHandler<HTMLButtonElement>;
  showDetailsControl?: boolean;
  /** When set, cover clicks and title navigate here instead of opening the cover modal. */
  detailHref?: string;
}

function BookSummaryCard({
  book,
  returnBook,
  showDetailsControl = true,
  detailHref,
}: BookSummaryCardProps) {
  const router = useRouter();
  const [src, setSrc] = useState(`/api/images/${book.id}`);
  const [modalOpen, setModalOpen] = useState(false);

  const isRented = book.rentalStatus === "rented";
  const copyCount = book.copyCount ?? 1;

  const handleOpenModal = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (detailHref) {
        router.push(detailHref);
      } else {
        setModalOpen(true);
      }
    },
    [detailHref, router],
  );

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleImageError = useCallback(() => {
    setSrc("/coverimages/default.jpg");
  }, []);

  const handleReturnClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      returnBook(e);
    },
    [returnBook],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (detailHref) {
          router.push(detailHref);
        } else {
          setModalOpen(true);
        }
      }
    },
    [detailHref, router],
  );

  return (
    // Sheets peeking out behind the card, so a title the library holds several
    // times reads as a stack at a glance rather than only through a number in
    // the corner. Decorative: the count is announced on the badge instead.
    <div className="relative inline-block">
      {copyCount > 1 && (
        <span
          aria-hidden="true"
          data-cy="card_stack"
          className="absolute inset-0 rounded-[16px] bg-card/70 border border-border
                     translate-x-[5px] translate-y-[5px]
                     transition-transform duration-300
                     group-hover/card:translate-x-[7px] group-hover/card:translate-y-[7px]"
        />
      )}
      {copyCount > 2 && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-[16px] bg-card/85 border border-border
                     translate-x-[2px] translate-y-[2px]
                     transition-transform duration-300
                     group-hover/card:translate-x-[3px] group-hover/card:translate-y-[3px]"
        />
      )}
      <article
        aria-label={`${book.title} von ${book.author}`}
        data-cy={`book_summary_card_${book.id}`}
        className="group/card relative overflow-hidden cursor-pointer
                 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                 shadow-[0_4px_12px_rgba(0,0,0,0.1)]
                 hover:-translate-y-1 hover:scale-[1.02]
                 hover:shadow-[0_20px_40px_color-mix(in_srgb,var(--primary)_30%,transparent),0_0_20px_color-mix(in_srgb,var(--primary)_20%,transparent)]
                 focus-within:-translate-y-1 focus-within:scale-[1.02]
                 focus-within:shadow-[0_20px_40px_color-mix(in_srgb,var(--primary)_30%,transparent),0_0_20px_color-mix(in_srgb,var(--primary)_20%,transparent)]
                 focus-visible:outline-3 focus-visible:outline-primary-light focus-visible:outline-offset-2"
        style={{
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          borderRadius: 16,
        }}
      >
        {/* Cover image. Where the card leads somewhere it is a real link, so a
          click works before React has hydrated and the usual browser gestures
          (middle-click, open in new tab) do too. Without a destination it
          falls back to a button that zooms the cover. */}
        {detailHref ? (
          <Link
            href={detailHref}
            aria-label={`Details zu ${book.title}`}
            className="absolute inset-0 z-[1]"
          >
            <Image
              src={src}
              alt=""
              fill
              sizes={`${CARD_WIDTH}px`}
              className="object-cover transition-transform duration-300
                       group-hover/card:scale-105 group-focus-within/card:scale-105"
              onError={handleImageError}
            />
          </Link>
        ) : (
          <div
            className="absolute inset-0 z-[1] cursor-zoom-in"
            onClick={handleOpenModal}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="button"
            aria-label={`Cover von ${book.title} vergrößern`}
          >
            <Image
              src={src}
              alt=""
              fill
              sizes={`${CARD_WIDTH}px`}
              className="object-cover transition-transform duration-300
                     group-hover/card:scale-105 group-focus-within/card:scale-105"
              onError={handleImageError}
            />
          </div>
        )}

        {/* Gradient Overlay */}
        <div
          className="absolute inset-0 z-[2] pointer-events-none"
          aria-hidden="true"
          style={{
            background: `linear-gradient(
            to top,
            rgba(0,0,0,0.92) 0%,
            rgba(0,0,0,0.8) 25%,
            rgba(0,0,0,0.4) 45%,
            rgba(0,0,0,0.05) 65%,
            transparent 100%
          )`,
          }}
        />

        {/* Status Badge */}
        <StatusBadge rentalStatus={book.rentalStatus} />

        {/* Top-right: Book ID + Return Button */}
        <div className="absolute top-2.5 right-2.5 z-[4] flex items-center gap-1">
          <span
            className="px-1.5 py-0.5 rounded-lg bg-black/40 backdrop-blur-lg
                     text-[0.6rem] font-medium text-white/95"
            aria-label={`Buch-ID: ${book.id}`}
          >
            #{book.id}
          </span>

          {/* Copies. The card stands for a title, not a single volume, so it has
            to say when the library holds more than one. */}
          {copyCount > 1 && (
            <span
              className="px-1.5 py-0.5 rounded-lg bg-black/40 backdrop-blur-lg
                       text-[0.6rem] font-medium text-white/95"
              aria-label={t("bookCard.copies", { count: String(copyCount) })}
              title={t("bookCard.copies", { count: String(copyCount) })}
              data-cy="book_card_copycount"
            >
              {copyCount}&times;
            </span>
          )}

          {isRented && showDetailsControl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleReturnClick}
                  aria-label="Buch abgeben"
                  className="flex items-center justify-center
                           w-[26px] h-[26px] rounded-md
                           bg-destructive/85 text-white backdrop-blur-sm
                           shadow-[0_2px_8px_color-mix(in_srgb,var(--destructive)_40%,transparent)]
                           hover:bg-destructive hover:scale-110
                           focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2
                           transition-all duration-200"
                >
                  <ArrowLeftFromLine className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Buch abgeben</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Content Area. Clicks fall through to the card-wide link underneath,
          so the whole card is clickable; the title re-enables its own. */}
        <div
          className="absolute bottom-0 left-0 right-0 p-3 z-[3] flex flex-col gap-1
                   pointer-events-none"
        >
          {/* Title — linked to detail/admin page when applicable */}
          {showDetailsControl || detailHref ? (
            <Link
              href={detailHref ?? `/book/${book.id}`}
              aria-label={`Details zu ${book.title}`}
              className="no-underline pointer-events-auto"
            >
              <h3
                data-cy="book_title"
                className="text-[0.85rem] font-semibold text-white leading-tight
                         line-clamp-2 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]
                         transition-colors duration-200 hover:text-primary-light"
              >
                {book.title}
              </h3>
            </Link>
          ) : (
            <h3
              data-cy="book_title"
              className="text-[0.85rem] font-semibold text-white leading-tight
                       line-clamp-2 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
            >
              {book.title}
            </h3>
          )}

          {/* Subtitle (Untertitel) */}
          {book.subtitle && (
            <p
              data-cy="book_subtitle"
              className="text-[0.7rem] text-white/60 leading-tight truncate
                       drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
              title={book.subtitle}
            >
              {book.subtitle}
            </p>
          )}

          {/* Author */}
          <p
            className="text-[0.7rem] text-white/85 truncate
                     drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
          >
            {book.author}
          </p>
        </div>

        {/* Glow Effect Layer */}
        <div
          className="absolute inset-0 z-0 rounded-[16px] pointer-events-none
                   opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100
                   transition-opacity duration-300"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--primary-light) 15%, transparent) 0%, transparent 60%)",
          }}
        />

        {/* Cover Modal — only when not using detailHref */}
        {!detailHref && (
          <CoverModal
            open={modalOpen}
            onClose={handleCloseModal}
            src={src}
            title={book.title ?? "Unbekannter Titel"}
            subtitle={book.subtitle}
            author={book.author ?? "Unbekannter Autor"}
          />
        )}
      </article>
    </div>
  );
}

export default memo(BookSummaryCard);
