import BookSearchBar from "@/components/book/BookSearchBar";
import BookSummaryCard from "@/components/book/BookSummaryCard";
import FacetBar from "@/components/book/FacetBar";
import PaginationControls from "@/components/book/PaginationControls";
import Layout from "@/components/layout/Layout";
import { getPagedPublicBooks, TopicFacet } from "@/entities/book";
import { BookType } from "@/entities/BookType";
import { prisma } from "@/entities/db";
import { PublicBookType } from "@/entities/PublicBookType";
import { LogEvents } from "@/lib/logEvents";
import { errorLogger } from "@/lib/logger";
import {
  effectivePageSize,
  getPositiveInt,
  getQueryValues,
  getSingleQueryValue,
  readQueryValue,
  readQueryValues,
} from "@/lib/utils/queryParams";
import { GetServerSideProps, GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
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
  initialPage: number;
  initialTopics: string[];
  facets: TopicFacet[];
}

interface PagedCatalogResponse {
  books: Array<PublicBookType | CatalogBookType>;
  total: number;
  page: number;
  pageSize: number;
  facets: TopicFacet[];
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
    copyCount: b.copyCount,
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
  initialPage,
  initialTopics,
  facets: initialFacets,
}: CatalogPropsType) {
  const router = useRouter();

  // What is being searched, which page, and which topics all live in the URL
  // rather than in component state. That is what makes the back button work:
  // open a book from a result list, go back, and the address still carries the
  // search, so the same results come back. It also makes a result list
  // something you can bookmark or send to someone.
  const serverSearch = readQueryValue(router.query.q);
  const selectedTopics = readQueryValues(router.query.topic);
  const page = Math.max(
    1,
    parseInt(readQueryValue(router.query.page), 10) || 1,
  );

  // The field itself stays local so typing never waits for the router.
  const [bookSearchInput, setBookSearchInput] = useState(initialSearch);

  // Keep the field in step when the address changes underneath us, which is
  // what a press of the back button looks like from here.
  useEffect(() => {
    setBookSearchInput(serverSearch);
  }, [serverSearch]);

  const applyQuery = useCallback(
    (
      next: { q?: string; page?: number; topics?: string[] },
      mode: "push" | "replace",
    ) => {
      const query: Record<string, string | string[]> = {};
      const q = (next.q ?? serverSearch).trim();
      const topics = next.topics ?? selectedTopics;
      const nextPage = next.page ?? page;
      if (q) query.q = q;
      if (topics.length > 0) query.topic = topics;
      if (nextPage > 1) query.page = String(nextPage);
      // Shallow: the data comes from SWR, so there is no reason to make the
      // server render the page again just because the address changed.
      router[mode]({ pathname: router.pathname, query }, undefined, {
        shallow: true,
      });
    },
    [router, serverSearch, selectedTopics, page],
  );

  // The search runs on Enter, never while typing. Searching as you type looked
  // cheap but was not: at a comfortable typing speed it fired on nearly every
  // keystroke, and each one is a query plus a recount of the topic facets.
  // Typing still costs nothing, because the topic suggestions under the field
  // are filtered from the facet list the page already has.
  const handleSubmitSearch = useCallback(
    (value: string) => {
      applyQuery({ q: value, page: 1 }, "push");
    },
    [applyQuery],
  );

  // Emptying the field is the one exception: it means "show me everything
  // again", and waiting for Enter there feels broken.
  useEffect(() => {
    if (bookSearchInput === "" && serverSearch !== "") {
      applyQuery({ q: "", page: 1 }, "replace");
    }
  }, [bookSearchInput, serverSearch, applyQuery]);

  const pageSize = effectivePageSize(numberBooksToShow, maxBooks);

  // One builder for both keys below, so the comparison cannot drift apart.
  const buildUrl = useCallback(
    (requestedPage: number, query: string, topics: string[]) => {
      const params = new URLSearchParams({
        page: String(requestedPage),
        pageSize: String(pageSize),
      });
      if (query.trim()) params.set("q", query.trim());
      // Repeated rather than delimited, so a topic may contain any character.
      for (const topic of topics) params.append("topic", topic);
      return `/api/public/books?${params.toString()}`;
    },
    [pageSize],
  );

  const requestUrl = useMemo(
    () => buildUrl(page, serverSearch, selectedTopics),
    [buildUrl, page, serverSearch, selectedTopics],
  );

  // The key getServerSideProps already answered: page 1 of the initial search.
  const ssrUrl = useMemo(
    () => buildUrl(initialPage, initialSearch, initialTopics),
    [buildUrl, initialPage, initialSearch, initialTopics],
  );

  const { data } = useSWR<PagedCatalogResponse>(requestUrl, fetcher, {
    // Offered for the server-rendered key only. fallbackData is not keyed, so
    // handing it to every key would show page 1 while another page loads.
    fallbackData:
      requestUrl === ssrUrl
        ? {
            books: initialBooks,
            total: initialTotal,
            page: initialPage,
            pageSize,
            facets: initialFacets,
          }
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
  const facets = data?.facets ?? initialFacets;

  const nextTopics = useCallback(
    (topic: string) =>
      selectedTopics.includes(topic)
        ? selectedTopics.filter((t) => t !== topic)
        : [...selectedTopics, topic],
    [selectedTopics],
  );

  // Picking a suggestion turns what was typed into a filter, so the field is
  // emptied: leaving it would search for the same words twice.
  const handleSelectSuggestion = useCallback(
    (topic: string) => {
      setBookSearchInput("");
      applyQuery({ topics: nextTopics(topic), page: 1, q: "" }, "push");
    },
    [applyQuery, nextTopics],
  );

  // Toggling a pill is a different act: it narrows or widens alongside a
  // search that was already committed, so that search stays.
  const handleToggleTopic = useCallback(
    (topic: string) => {
      applyQuery({ topics: nextTopics(topic), page: 1 }, "push");
    },
    [applyQuery, nextTopics],
  );

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
    if (page > totalPages) applyQuery({ page: totalPages }, "replace");
  }, [page, totalPages, applyQuery]);

  const handlePageChange = useCallback(
    (next: number) => {
      applyQuery({ page: next }, "push");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [applyQuery],
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
        facets={facets}
        selectedTopics={selectedTopics}
        onToggleTopic={handleSelectSuggestion}
        onSubmitSearch={handleSubmitSearch}
        showNewBookControl={false}
        showViewToggle={false}
      />
      <FacetBar
        facets={facets}
        selected={selectedTopics}
        onToggle={handleToggleTopic}
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
  const initialSearch = getSingleQueryValue(context.query.q);
  // A shared or bookmarked link, and a back navigation that reaches the
  // server rather than the client cache, must render the page that was asked
  // for rather than always the first one.
  const initialPage = getPositiveInt(context.query.page) ?? 1;
  const initialTopics = getQueryValues(context.query.topic);

  try {
    // Calls the same entity function the API route uses, in-process:
    // no self-HTTP round trip, no double JSON serialization.
    const data = await getPagedPublicBooks(prisma, {
      page: initialPage,
      pageSize: effectivePageSize(numberBooksToShow, maxBooks),
      query: initialSearch,
      topics: initialTopics,
      maxTitles: maxBooks,
    });
    const books = data.books.map(toCardBook);
    return {
      props: {
        books,
        total: data.total,
        numberBooksToShow,
        maxBooks,
        initialSearch,
        initialPage,
        initialTopics,
        facets: data.facets,
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
