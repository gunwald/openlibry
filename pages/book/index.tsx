import Layout from "@/components/layout/Layout";
import { GetServerSideProps, GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import BookSearchBar from "@/components/book/BookSearchBar";
import BookSummaryCard from "@/components/book/BookSummaryCard";
import FacetBar from "@/components/book/FacetBar";
import PaginationControls from "@/components/book/PaginationControls";

import SummaryRowContainer from "@/components/book/SummaryRowContainer";
import { BookType } from "@/entities/BookType";
import {
  getPagedBooks,
  ListBookType,
  PagedBooks,
  TopicFacet,
} from "@/entities/book";
import { prisma, reconnectPrisma } from "@/entities/db";
import { t } from "@/lib/i18n";
import {
  effectivePageSize,
  getPositiveInt,
  getQueryValues,
  getSingleQueryValue,
  readQueryValue,
  readQueryValues,
} from "@/lib/utils/queryParams";
import { toast } from "sonner";

interface BookPropsType {
  books: Array<ListBookType>;
  total: number;
  numberBooksToShow: number;
  maxBooks: number;
  initialSearch: string;
  initialPage: number;
  initialTopics: string[];
  facets: TopicFacet[];
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
  initialPage,
  initialTopics,
  facets: initialFacets,
}: BookPropsType) {
  const router = useRouter();

  // Search, page and topics live in the address rather than in state, so
  // opening a book from a result list and pressing back brings the same list
  // back, and a result list can be linked to. One page is on screen at a
  // time: growing the page size instead would keep every card already seen
  // mounted, and scrolling and typing get slower the longer it is used.
  const serverSearch = readQueryValue(router.query.q);
  const selectedTopics = readQueryValues(router.query.topic);
  const copiesOf = readQueryValue(router.query.copiesOf);
  const page = Math.max(
    1,
    parseInt(readQueryValue(router.query.page), 10) || 1,
  );

  // The field itself stays local so typing never waits for the router.
  const [bookSearchInput, setBookSearchInput] = useState(initialSearch);

  // Which view you are looking at is part of where you are, so it lives in the
  // address with the search and the page. Cards are the default, so only the
  // list view names itself and an untouched URL stays clean.
  const detailView = readQueryValue(router.query.view) !== "list";

  useEffect(() => {
    setBookSearchInput(serverSearch);
  }, [serverSearch]);

  const applyQuery = useCallback(
    (
      next: {
        q?: string;
        page?: number;
        topics?: string[];
        listView?: boolean;
        copiesOf?: string | null;
      },
      mode: "push" | "replace",
    ) => {
      const query: Record<string, string | string[]> = {};
      const q = (next.q ?? serverSearch).trim();
      const topics = next.topics ?? selectedTopics;
      const nextPage = next.page ?? page;
      const listView = next.listView ?? !detailView;
      // Carried like the rest of the list state, or paging out of an expanded
      // title silently collapsed it back into one grouped row.
      const nextCopiesOf = next.copiesOf === undefined ? copiesOf : next.copiesOf;
      if (q) query.q = q;
      if (topics.length > 0) query.topic = topics;
      if (nextPage > 1) query.page = String(nextPage);
      if (listView) query.view = "list";
      if (nextCopiesOf) query.copiesOf = nextCopiesOf;
      router[mode]({ pathname: router.pathname, query }, undefined, {
        shallow: true,
      });
    },
    [router, serverSearch, selectedTopics, page, detailView, copiesOf],
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

  // One builder for both keys below, so the comparison cannot drift apart.
  const buildUrl = useCallback(
    (requestedPage: number, query: string, topics: string[]) => {
      const params = new URLSearchParams({
        page: String(requestedPage),
        pageSize: String(effectivePageSize(numberBooksToShow, maxBooks)),
      });
      if (query.trim()) params.set("q", query.trim());
      // Repeated rather than delimited, so a topic may contain any character.
      for (const topic of topics) params.append("topic", topic);
      if (copiesOf) params.set("copiesOf", copiesOf);
      return `/api/book?${params.toString()}`;
    },
    [numberBooksToShow, maxBooks, copiesOf],
  );

  const requestUrl = useMemo(
    () => buildUrl(page, serverSearch, selectedTopics),
    [buildUrl, page, serverSearch, selectedTopics],
  );

  // The key getServerSideProps already answered.
  const ssrUrl = useMemo(
    () => buildUrl(initialPage, initialSearch, initialTopics),
    [buildUrl, initialPage, initialSearch, initialTopics],
  );

  const { data: freshData, mutate } = useSWR<PagedBooks>(requestUrl, fetcher, {
    // Only for the key the server answered. fallbackData is not keyed, so
    // handing it to every key would show page one while another page loads.
    fallbackData:
      requestUrl === ssrUrl
        ? {
            books: initialBooks,
            total: initialTotal,
            page: initialPage,
            pageSize: effectivePageSize(numberBooksToShow, maxBooks),
            facets: initialFacets,
          }
        : undefined,
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

  // No client-side reordering. The server ranks an exact id match to the top
  // of the first page before paginating; re-sorting here could only reorder the
  // page already fetched, and the title-first rule it used actually undid the
  // pin whenever the scanned book's title did not contain the digits.
  const renderedBooks = books;

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
    applyQuery({ listView: detailView }, "push");
  }, [applyQuery, detailView]);

  const pageSize = effectivePageSize(numberBooksToShow, maxBooks);
  const totalPages = Math.max(
    1,
    Math.ceil(Math.min(resultCount, maxBooks) / pageSize),
  );

  // A shrinking result set (a narrower search) can leave us past the end.
  useEffect(() => {
    if (page > totalPages) applyQuery({ page: totalPages }, "replace");
  }, [page, totalPages, applyQuery]);

  const facets = freshData?.facets ?? initialFacets;

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

  const handlePageChange = useCallback(
    (next: number) => {
      applyQuery({ page: next }, "push");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [applyQuery],
  );

  return (
    <Layout>
      <BookSearchBar
        handleInputChange={handleInputChangeEvent}
        handleNewBook={handleCreateNewBook}
        bookSearchInput={bookSearchInput}
        toggleView={toggleView}
        detailView={detailView}
        searchResultNumber={resultCount}
        facets={facets}
        selectedTopics={selectedTopics}
        onToggleTopic={handleSelectSuggestion}
        onSubmitSearch={handleSubmitSearch}
      />
      <FacetBar
        facets={facets}
        selected={selectedTopics}
        onToggle={handleToggleTopic}
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
    const initialSearch = getSingleQueryValue(context.query.q);
    const initialPage = getPositiveInt(context.query.page) ?? 1;
    const initialTopics = getQueryValues(context.query.topic);
    const initialCopiesOf = getSingleQueryValue(context.query.copiesOf);

    // Same entity function the API route uses, in-process — SSR and client
    // revalidation can't drift apart.
    const { books, total, facets } = await getPagedBooks(prisma, {
      page: initialPage,
      pageSize: effectivePageSize(numberBooksToShow, maxBooks),
      query: initialSearch,
      topics: initialTopics,
      copiesOf: initialCopiesOf,
    });

    return {
      props: {
        books,
        total,
        numberBooksToShow,
        maxBooks,
        initialSearch,
        initialPage,
        initialTopics,
        facets,
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
