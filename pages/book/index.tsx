import Layout from "@/components/layout/Layout";
import { GetServerSideProps, GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import BookSearchBar from "@/components/book/BookSearchBar";
import BookSummaryCard from "@/components/book/BookSummaryCard";
import PaginationControls from "@/components/book/PaginationControls";

import SummaryRowContainer from "@/components/book/SummaryRowContainer";
import { BookType } from "@/entities/BookType";
import { getPagedBooks, ListBookType, PagedBooks } from "@/entities/book";
import { prisma, reconnectPrisma } from "@/entities/db";
import { t } from "@/lib/i18n";
import { toast } from "sonner";

interface BookPropsType {
  books: Array<ListBookType>;
  total: number;
  numberBooksToShow: number;
  maxBooks: number;
  initialSearch: string;
  _timestamp?: number;
}

interface DetailCardContainerProps {
  renderedBooks: BookType[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onReturnBook: (id: number, userId: number) => void;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const DetailCardContainer = memo(function DetailCardContainer({
  renderedBooks,
  page,
  totalPages,
  onPageChange,
  onReturnBook,
}: DetailCardContainerProps) {
  return (
    <div>
      <div
        className="grid gap-3 justify-items-center py-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
      >
        {renderedBooks.map((b: BookType) => (
          <BookSummaryCard
            key={b.id}
            book={b}
            returnBook={() => onReturnBook(b.id!, b.userId!)}
            detailHref={`/book/${b.id}`}
          />
        ))}
      </div>
      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
});

// =============================================================================
// Page Component
// =============================================================================

export default function Books({
  books: initialBooks,
  total: initialTotal,
  numberBooksToShow,
  maxBooks,
  initialSearch,
}: BookPropsType) {
  const router = useRouter();
  const { query } = useRouter();
  const [bookSearchInput, setBookSearchInput] = useState(initialSearch);
  const [serverSearch, setServerSearch] = useState(initialSearch);
  // One page on screen at a time. Growing the page size instead would keep
  // every card already seen mounted, and scrolling and typing get slower the
  // longer the list is used.
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (typeof query.q === "string" && query.q) {
      setBookSearchInput(query.q);
      setServerSearch(query.q);
      setPage(1);
      setDetailView(true);
    }
  }, [query.q]);

  useEffect(() => {
    const id = setTimeout(() => {
      setServerSearch(bookSearchInput);
      setPage(1);
    }, 150);

    return () => clearTimeout(id);
  }, [bookSearchInput]);

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: Math.min(numberBooksToShow, maxBooks).toString(),
    });
    if (serverSearch.trim()) params.set("q", serverSearch.trim());
    return `/api/book?${params.toString()}`;
  }, [page, numberBooksToShow, maxBooks, serverSearch]);

  const { data: freshData, mutate } = useSWR<PagedBooks>(requestUrl, fetcher, {
    fallbackData: {
      books: initialBooks,
      total: initialTotal,
      page: 1,
      pageSize: numberBooksToShow,
    },
    // Without this, every key change (new search term, another page) would
    // fall back to the initial unfiltered page-1 data while the fetch is in
    // flight — a visible flash of wrong results.
    keepPreviousData: true,
    refreshInterval: 0,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    // Keep this short (SWR default is 2s): edits happen on other pages, and
    // a long window would serve a stale cached list when navigating back.
    // It doesn't help with typing anyway — each search term is its own key.
    dedupingInterval: 2000,
  });

  const books = freshData?.books || initialBooks;
  const resultCount = freshData?.total ?? initialTotal;

  const [detailView, setDetailView] = useState(true);

  // Numeric-query priority sort: if the query contains digits, bubble books
  // whose title contains those digits to the top. Runs only when the query
  // or the base results change — no extra state needed.
  const renderedBooks = useMemo(() => {
    const numbersInQuery = bookSearchInput.match(/\d+/g);
    if (!numbersInQuery) return books;

    return [...books].sort((a, b) => {
      const aMatch = numbersInQuery.some((n) =>
        a.title?.toString().includes(n),
      );
      const bMatch = numbersInQuery.some((n) =>
        b.title?.toString().includes(n),
      );
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }, [books, bookSearchInput]);

  // Adapt hook's string-based handler to the event-based signature
  // BookSearchBar expects, and reset pagination on every new search.
  const handleInputChangeEvent = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      setBookSearchInput(e.target.value);
    },
    [],
  );

  const handleCreateNewBook = useCallback(() => {
    router.push("/book/new");
  }, [router]);

  const handleCopyBook = useCallback(
    (_book: BookType) => {
      router.push("/book/new");
      toast.info(t("bookPage.toastCreateNewBook"));
    },
    [router],
  );

  // No optimistic update here — mutate() triggers SWR revalidation which
  // flows back into the hook and re-renders with fresh data.
  const handleReturnBook = useCallback(
    (id: number, userid: number) => {
      fetch(`/api/book/${id}/user/${userid}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      })
        .then((res) => res.json())
        .then(() => {
          mutate();
          toast.success(t("bookPage.toastBookReturned"));
        })
        .catch(() => {
          toast.error(t("bookPage.toastReturnError"));
        });
    },
    [mutate],
  );

  const toggleView = useCallback(() => {
    setDetailView((prev) => !prev);
  }, []);

  const pageSize = Math.min(numberBooksToShow, maxBooks);
  const totalPages = Math.max(
    1,
    Math.ceil(Math.min(resultCount, maxBooks) / pageSize),
  );

  // A shrinking result set (a narrower search) can leave us past the end.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handlePageChange = useCallback((next: number) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <Layout>
      <BookSearchBar
        handleInputChange={handleInputChangeEvent}
        handleNewBook={handleCreateNewBook}
        bookSearchInput={bookSearchInput}
        toggleView={toggleView}
        detailView={detailView}
        searchResultNumber={resultCount}
      />
      {detailView ? (
        <DetailCardContainer
          renderedBooks={renderedBooks}
          page={page}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          onReturnBook={handleReturnBook}
        />
      ) : (
        <SummaryRowContainer
          renderedBooks={renderedBooks}
          page={page}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          onCopyBook={handleCopyBook}
        />
      )}
    </Layout>
  );
}

// =============================================================================
// Server-side data fetching
// =============================================================================

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  if (process.env.NODE_ENV !== "production") {
    await reconnectPrisma();
  }

  context.res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  );
  context.res.setHeader("Pragma", "no-cache");
  context.res.setHeader("Expires", "0");

  try {
    const numberBooksToShow = process.env.NUMBER_BOOKS_OVERVIEW
      ? parseInt(process.env.NUMBER_BOOKS_OVERVIEW)
      : 10;
    const maxBooks = process.env.NUMBER_BOOKS_MAX
      ? parseInt(process.env.NUMBER_BOOKS_MAX)
      : 1000000;
    const initialSearch =
      typeof context.query.q === "string" ? context.query.q : "";

    // Same entity function the API route uses, in-process — SSR and client
    // revalidation can't drift apart.
    const { books, total } = await getPagedBooks(prisma, {
      page: 1,
      pageSize: numberBooksToShow,
      query: initialSearch,
    });

    return {
      props: {
        books,
        total,
        numberBooksToShow,
        maxBooks,
        initialSearch,
        _timestamp: Date.now(),
      },
    };
  } catch (error) {
    console.error("Error fetching books:", error);
    return {
      props: {
        books: [],
        total: 0,
        numberBooksToShow: 10,
        maxBooks: 1000000,
        initialSearch: "",
        _timestamp: Date.now(),
      },
    };
  }
};
