import BookSearchBar from "@/components/book/BookSearchBar";
import BookSummaryCard from "@/components/book/BookSummaryCard";
import PaginationControls from "@/components/book/PaginationControls";
import Layout from "@/components/layout/Layout";
import { getPagedPublicBooks } from "@/entities/book";
import { BookType } from "@/entities/BookType";
import { prisma } from "@/entities/db";
import { PublicBookType } from "@/entities/PublicBookType";
import { LogEvents } from "@/lib/logEvents";
import { errorLogger } from "@/lib/logger";
import { GetServerSideProps, GetServerSidePropsContext } from "next";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

// =============================================================================
// Types
// =============================================================================

interface CatalogBookType extends BookType {
  searchableTopics: Array<string>;
}

interface CatalogPropsType {
  books: Array<CatalogBookType>;
  total: number;
  numberBooksToShow: number;
  maxBooks: number;
  initialSearch: string;
}

interface PagedCatalogResponse {
  books: Array<PublicBookType | CatalogBookType>;
  total: number;
  page: number;
  pageSize: number;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * SWR fetcher that throws on non-2xx responses so SWR captures the error
 * instead of trying to JSON-parse an HTML error page and crashing with
 * "Unexpected token '<'". Only used for client-side revalidation — the
 * initial data comes from getServerSideProps below, not this fetch.
 */
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  });

/**
 * Map PublicBookType → BookType-compatible shape for existing components.
 */
function toCardBook(b: PublicBookType | CatalogBookType): CatalogBookType {
  return {
    id: b.id,
    title: b.title ?? "",
    author: b.author ?? "",
    isbn: b.isbn ?? "",
    topics: b.topics ?? "",
    rentalStatus: b.rentalStatus,
    renewalCount: 0,
    searchableTopics: b.topics ? b.topics.split(";").map((t) => t.trim()) : [],
  } as CatalogBookType;
}

// =============================================================================
// Card Grid
// =============================================================================

interface CatalogCardGridProps {
  renderedBooks: BookType[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const CatalogCardGrid = memo(function CatalogCardGrid({
  renderedBooks,
  page,
  totalPages,
  onPageChange,
}: CatalogCardGridProps) {
  const noop = useCallback(() => {}, []);

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
            returnBook={noop}
            showDetailsControl={false}
            detailHref={`/catalog/${b.id}`}
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

export default function Catalog({
  books: initialBooks,
  total: initialTotal,
  numberBooksToShow,
  maxBooks,
  initialSearch,
}: CatalogPropsType) {
  const [bookSearchInput, setBookSearchInput] = useState(initialSearch);
  const [serverSearch, setServerSearch] = useState(initialSearch);
  // One page is on screen at a time. Growing a page size instead would keep
  // every card already seen mounted, and the cost of scrolling and typing
  // grows with it: a few hundred cards is enough to make the page feel slow.
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setServerSearch(bookSearchInput);
      setPage(1);
    }, 150);

    return () => clearTimeout(id);
  }, [bookSearchInput]);

  const pageSize = Math.min(numberBooksToShow, maxBooks);

  // One builder for both keys below, so the comparison cannot drift apart.
  const buildUrl = useCallback(
    (requestedPage: number, query: string) => {
      const params = new URLSearchParams({
        page: String(requestedPage),
        pageSize: String(pageSize),
      });
      if (query.trim()) params.set("q", query.trim());
      return `/api/public/books?${params.toString()}`;
    },
    [pageSize],
  );

  const requestUrl = useMemo(
    () => buildUrl(page, serverSearch),
    [buildUrl, page, serverSearch],
  );

  // The key getServerSideProps already answered: page 1 of the initial search.
  const ssrUrl = useMemo(
    () => buildUrl(1, initialSearch),
    [buildUrl, initialSearch],
  );

  const { data } = useSWR<PagedCatalogResponse>(requestUrl, fetcher, {
    // Offered for the server-rendered key only. fallbackData is not keyed, so
    // handing it to every key would show page 1 while another page loads.
    fallbackData:
      requestUrl === ssrUrl
        ? { books: initialBooks, total: initialTotal, page: 1, pageSize }
        : undefined,
    // The page already contains this exact response, so there is nothing to
    // revalidate on mount; without this the catalog fetched page 1 twice on
    // every visit. Another page or search term is a key with no cached data
    // and still fetches.
    revalidateIfStale: false,
    // Without this, every key change (new search term, another page) would
    // briefly render with no data at all — a visible flash of empty results.
    keepPreviousData: true,
    refreshInterval: 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000,
  });

  const books = useMemo(
    () => (data?.books ?? initialBooks).map(toCardBook),
    [data?.books, initialBooks],
  );
  const resultCount = data?.total ?? initialTotal;

  const handleInputChangeEvent = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      setBookSearchInput(e.target.value);
    },
    [],
  );

  const totalPages = Math.max(
    1,
    Math.ceil(Math.min(resultCount, maxBooks) / pageSize),
  );

  // A shrinking result set (a narrower search) can leave us past the end.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handlePageChange = useCallback(
    (next: number) => {
      setPage(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [],
  );

  const noop = useCallback(() => {}, []);

  return (
    <Layout publicView={true}>
      <BookSearchBar
        handleInputChange={handleInputChangeEvent}
        handleNewBook={noop}
        bookSearchInput={bookSearchInput}
        toggleView={noop}
        detailView={true}
        searchResultNumber={resultCount}
        showNewBookControl={false}
        showViewToggle={false}
      />
      <CatalogCardGrid
        renderedBooks={books}
        page={page}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />
    </Layout>
  );
}

// =============================================================================
// Server-side data fetching
// =============================================================================

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const numberBooksToShow = process.env.NUMBER_BOOKS_OVERVIEW
    ? parseInt(process.env.NUMBER_BOOKS_OVERVIEW)
    : 10;
  const maxBooks = process.env.NUMBER_BOOKS_MAX
    ? parseInt(process.env.NUMBER_BOOKS_MAX)
    : 1000000;
  const initialSearch =
    typeof context.query.q === "string" ? context.query.q : "";

  try {
    // Calls the same entity function the API route uses, in-process:
    // no self-HTTP round trip, no double JSON serialization.
    const data = await getPagedPublicBooks(prisma, {
      page: 1,
      pageSize: numberBooksToShow,
      query: initialSearch,
    });
    const books = data.books.map(toCardBook);
    return {
      props: {
        books,
        total: data.total,
        numberBooksToShow,
        maxBooks,
        initialSearch,
      },
    };
  } catch (error) {
    errorLogger.error(
      {
        event: LogEvents.API_ERROR,
        endpoint: "/catalog (getServerSideProps)",
        error: error instanceof Error ? error.message : String(error),
      },
      "Error fetching public catalog",
    );
    return {
      props: {
        books: [],
        total: 0,
        numberBooksToShow,
        maxBooks,
        initialSearch,
      },
    };
  }
};
