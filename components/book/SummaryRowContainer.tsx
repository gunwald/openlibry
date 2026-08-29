import BookSummaryRow from "@/components/book/BookSummaryRow";
import PaginationControls from "@/components/book/PaginationControls";
import { BookType } from "@/entities/BookType";
import { memo, useMemo } from "react";

type SummaryBook = BookType & { copyCount?: number };

interface SummaryRowContainerProps {
  renderedBooks: SummaryBook[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onCopyBook: (book: BookType) => void;
}

const SummaryRowContainer = memo(function SummaryRowContainer({
  renderedBooks,
  page,
  totalPages,
  onPageChange,
  onCopyBook,
}: SummaryRowContainerProps) {
  const groupedBooks = useMemo(() => {
    const map = new Map<string, SummaryBook[]>();

    for (const book of renderedBooks) {
      const key = book.isbn?.trim() ? book.isbn.trim() : `__no_isbn_${book.id}`;
      const group = map.get(key) ?? [];
      group.push(book);
      map.set(key, group);
    }

    return Array.from(map.values()).map((group) => {
      const representative =
        group.find((b) => b.rentalStatus !== "rented") ?? group[0];
      const copyCount = Math.max(
        group.length,
        ...group.map((book) => book.copyCount ?? 0),
      );
      return { book: representative, count: copyCount };
    });
  }, [renderedBooks]);

  return (
    <div className="flex flex-col gap-2 w-full">
      {groupedBooks.map(({ book, count }) => (
        <BookSummaryRow
          key={book.id}
          book={book}
          count={count}
          handleCopyBook={() => onCopyBook(book)}
        />
      ))}
      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
});

export default SummaryRowContainer;
