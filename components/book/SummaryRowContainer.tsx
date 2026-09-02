import BookSummaryRow from "@/components/book/BookSummaryRow";
import PaginationControls from "@/components/book/PaginationControls";
import { BookType } from "@/entities/BookType";
import { memo } from "react";

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
  // Grouping is the server's job now. Doing it here grouped only what happened
  // to be on the page, so a page of twenty-five copies could collapse into four
  // rows while the pager still called it a page of twenty-five.
  const groupedBooks = renderedBooks.map((book) => ({
    book,
    count: book.copyCount ?? 1,
  }));

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
