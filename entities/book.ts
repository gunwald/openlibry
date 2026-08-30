import { BookType } from "@/entities/BookType";
import { getRentalConfig } from "@/lib/config/rentalConfig";
import { LOCALE } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import { LogEvents } from "@/lib/logEvents";
import { businessLogger, errorLogger } from "@/lib/logger";
import { convertDateToDayString } from "@/lib/utils/dateutils";
import { Prisma, PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "fs/promises";
import path from "path";
import { addAudit } from "./audit";
import { PublicBookType } from "./PublicBookType";
import { getUser } from "./user";

const rentalConfig = getRentalConfig();

const publicBookSelect = {
  id: true,
  title: true,
  author: true,
  isbn: true,
  topics: true,
  rentalStatus: true,
} satisfies Prisma.BookSelect;

function toPublicBook(b: {
  id: number;
  title: string;
  author: string;
  isbn: string | null;
  topics: string | null;
  rentalStatus: string;
}): PublicBookType {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    isbn: b.isbn,
    topics: b.topics,
    rentalStatus: b.rentalStatus,
    // Cover is served by /api/images/[id]; auth-excluded in middleware.ts
    coverUrl: `/api/images/${b.id}`,
  };
}

export type PagedPublicBooks = {
  books: PublicBookType[];
  total: number;
  page: number;
  pageSize: number;
  /** Topic counts within the current filter, most common first. */
  facets: TopicFacet[];
};

type SearchableBookField = "title" | "author" | "subtitle" | "isbn" | "topics";

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Inflection endings per deployment locale, longest first so "Deutschen"
// strips "en" rather than "n". Keyed by Locale so wiring a new locale into
// the i18n layer forces a decision here too.
const STEM_SUFFIXES_BY_LOCALE: Record<Locale, string[]> = {
  de: ["en", "er", "es", "em", "e", "n", "s"],
  // "ies" covers y-plurals by prefix: "stories" → "stor" matches "story".
  en: ["ies", "ing", "ed", "es", "er", "e", "s"],
};
const STEM_SUFFIXES =
  STEM_SUFFIXES_BY_LOCALE[LOCALE] ?? STEM_SUFFIXES_BY_LOCALE.de;
const MIN_STEM_LENGTH = 4;

/**
 * Cheap query-side stemming: strip one inflection suffix when the remaining
 * stem keeps at least MIN_STEM_LENGTH characters. Because matching is
 * substring-based, searching for the stem covers every longer inflected form
 * in the data ("Deutsche" → "Deutsch" also finds "Deutschen" and
 * "Deutschland"; "Geschichten" → "Geschicht" also finds "Geschichte").
 * Umlaut plurals ("Bücher" vs "Buch") are out of scope. The minimum length
 * keeps short names intact ("Hans" stays "Hans" instead of matching every
 * "Han…"). Stripping only ever broadens a match (the stem is a prefix of
 * the term), so an imperfectly fitting suffix list costs precision on rare
 * queries, never correctness.
 *
 * Deliberately NOT a real stemmer (Snowball/Porter via a library): those
 * normalize both the indexed text and the query symmetrically, but here the
 * data sits unstemmed in SQLite and matching is `contains`, so the output
 * must stay a literal prefix of the inflected word. Library stemmers break
 * that invariant (Snowball German de-umlauts: "Gebäude" → "gebaud"; Porter:
 * "stories" → "stori", not a substring of "story") and would silently LOSE
 * results if applied to the query alone. A real stemmer only becomes
 * appropriate once stemming moves to index time (a stemmed shadow column or
 * SQLite FTS5) and is applied to both sides.
 */
function stemTerm(term: string): string | null {
  for (const suffix of STEM_SUFFIXES) {
    if (
      term.length - suffix.length >= MIN_STEM_LENGTH &&
      term.toLowerCase().endsWith(suffix)
    ) {
      return term.slice(0, -suffix.length);
    }
  }
  return null;
}

/**
 * SQLite's LIKE only case-folds ASCII, so `contains: "möwe"` would not match
 * "Möwe" (and Prisma's SQLite connector has no `mode: "insensitive"`).
 * Matching the term as typed, lowercased, and with a capitalized first letter
 * covers the common casings without a custom collation. Mixed-case matches in
 * the middle of a word (e.g. "McDonald" for query "mcdonald") still slip
 * through — accepted limitation.
 *
 * When the term carries an inflection suffix, the variants are built from its
 * stem instead; the stem is a prefix of the term, so it matches strictly more.
 */
function termVariants(term: string): string[] {
  const base = stemTerm(term) ?? term;
  const lower = base.toLowerCase();
  return Array.from(new Set([base, lower, capitalizeFirst(lower)]));
}

function buildBookWhere(
  query: string,
  fields: SearchableBookField[],
): Prisma.BookWhereInput | undefined {
  const q = query.trim();
  if (!q) return undefined;

  // "#12" is a lookup rather than a search: that one book and nothing else.
  // A bare "12" still searches, because it may be part of a title, but the
  // hash form is how you say you mean the number on the spine.
  const idLookup = q.match(/^#\s*(\d+)$/);
  if (idLookup) {
    const id = parseInt(idLookup[1].replace(/^0+/, "") || "0", 10);
    return Number.isFinite(id) ? { id } : undefined;
  }

  // AND across whitespace-separated terms, OR across fields per term, so
  // "Harry Rowling" finds a book whose title contains "Harry" and whose
  // author contains "Rowling".
  const perTerm: Prisma.BookWhereInput[] = q.split(/\s+/).map((term) => ({
    OR: fields.flatMap((field) =>
      termVariants(term).map((variant) => ({
        [field]: { contains: variant },
      })),
    ),
  }));

  const numericId = parseInt(q.replace(/^0+/, "") || q, 10);
  if (/^\d+$/.test(q) && Number.isFinite(numericId)) {
    return { OR: [{ id: numericId }, { AND: perTerm }] };
  }

  return { AND: perTerm };
}

export function getBookWhere(query: string): Prisma.BookWhereInput | undefined {
  return buildBookWhere(query, [
    "title",
    "author",
    "subtitle",
    "isbn",
    "topics",
  ]);
}

/**
 * Matches one whole topic inside the semicolon-separated `topics` column.
 *
 * A plain `contains` would be wrong: "Rom" would match "Romantik" and
 * "9. Jahrhundert" would match all 111 books tagged "19. Jahrhundert". The
 * four cases below anchor the match to the separators instead: the only
 * topic, the first, the last, or somewhere in the middle.
 */
export function topicWhere(topic: string): Prisma.BookWhereInput {
  return {
    OR: [
      { topics: topic },
      { topics: { startsWith: `${topic};` } },
      { topics: { endsWith: `;${topic}` } },
      { topics: { contains: `;${topic};` } },
    ],
  };
}

/** Combines the text query with any selected topics, all ANDed together. */
export function withTopics(
  where: Prisma.BookWhereInput | undefined,
  topics: string[],
): Prisma.BookWhereInput | undefined {
  const selected = topics.map((t) => t.trim()).filter(Boolean);
  if (selected.length === 0) return where;
  return { AND: [...(where ? [where] : []), ...selected.map(topicWhere)] };
}

export type TopicFacet = { topic: string; count: number };

/**
 * Counts topics across the books the current filter selects, most common
 * first, so the facet row reflects what is actually reachable from here.
 *
 * Reads only the `topics` column of the matching rows and tallies in memory.
 * That is a column scan rather than an aggregate per topic, which for a
 * school library (hundreds to a few thousand books) is the cheaper shape.
 */
export async function getTopicFacets(
  client: PrismaClient,
  where: Prisma.BookWhereInput | undefined,
  // Generous, because the cap is a payload guard rather than a display limit:
  // the row shows the handful that fit and the rest are reachable by searching
  // the panel. A library with more distinct topics than this loses only its
  // rarest tags from the filter, never from search. Counting costs the same
  // either way, since it is one scan of the topics column.
  limit = 400,
): Promise<TopicFacet[]> {
  // Counts titles, not copies, so a facet agrees with the result count beside
  // it: three copies of one book are one book in both places.
  const rows = await client.book.findMany({
    where,
    select: { topics: true, isbn: true, id: true },
  });

  const seenGroups = new Set<string>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const isbn = row.isbn?.trim();
    const groupKey = isbn ? `isbn:${isbn}` : `id:${row.id}`;
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    if (!row.topics) continue;
    // A book tagged the same topic twice must still count once.
    const seen = new Set<string>();
    for (const raw of row.topics.split(";")) {
      const topic = raw.trim();
      if (!topic || seen.has(topic)) continue;
      seen.add(topic);
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }

  return Array.from(counts, ([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, limit);
}

export function getPublicBookWhere(
  query: string,
): Prisma.BookWhereInput | undefined {
  // No subtitle: the public catalog's select doesn't expose it.
  return buildBookWhere(query, ["title", "author", "isbn", "topics"]);
}

export async function getCopyCountsByIsbn(
  client: PrismaClient,
  books: Array<{ isbn?: string | null }>,
  where: Prisma.BookWhereInput | undefined,
): Promise<Map<string, number>> {
  const rawIsbns = Array.from(
    new Set(
      books
        .map((book) => book.isbn)
        .filter((isbn): isbn is string => Boolean(isbn?.trim())),
    ),
  );

  if (rawIsbns.length === 0) return new Map();

  const counts = await client.book.groupBy({
    by: ["isbn"],
    where: {
      AND: [
        ...(where ? [where] : []),
        {
          isbn: {
            in: rawIsbns,
          },
        },
      ],
    },
    _count: {
      _all: true,
    },
  });

  const countByTrimmedIsbn = new Map<string, number>();

  for (const count of counts) {
    const isbn = count.isbn?.trim();
    if (!isbn) continue;
    countByTrimmedIsbn.set(
      isbn,
      (countByTrimmedIsbn.get(isbn) ?? 0) + count._count._all,
    );
  }

  return countByTrimmedIsbn;
}

// Fields the (authenticated) book list needs — a strict subset of the full
// Book model so list queries stay lean. Shared by /api/book and the book
// page's getServerSideProps so SSR and client revalidation return identical
// shapes.
export const listBookSelect = {
  createdAt: true,
  updatedAt: true,
  id: true,
  rentalStatus: true,
  rentedDate: true,
  dueDate: true,
  renewalCount: true,
  title: true,
  subtitle: true,
  author: true,
  topics: true,
  isbn: true,
  userId: true,
} satisfies Prisma.BookSelect;

export type ListBookType = BookType & {
  searchableTopics: string[];
  copyCount?: number;
};

export type PagedBooks = {
  books: ListBookType[];
  total: number;
  page: number;
  pageSize: number;
  /** Topic counts within the current filter, most common first. */
  facets: TopicFacet[];
};

export function toListBook(
  book: Prisma.BookGetPayload<{ select: typeof listBookSelect }>,
  copyCountsByIsbn: Map<string, number> = new Map(),
): ListBookType {
  const trimmedIsbn = book.isbn?.trim();
  const { subtitle, topics, isbn, userId, ...rest } = book;

  const listBook: ListBookType = {
    ...rest,
    createdAt: convertDateToDayString(book.createdAt) as any,
    updatedAt: convertDateToDayString(book.updatedAt) as any,
    rentedDate: book.rentedDate ? convertDateToDayString(book.rentedDate) : "",
    dueDate: book.dueDate ? convertDateToDayString(book.dueDate) : "",
    searchableTopics: topics ? topics.split(";") : [],
  };

  // Optional fields are left out entirely rather than set to undefined. Both
  // look the same once the API route serialises them to JSON, but
  // getServerSideProps validates its props and rejects an explicit undefined,
  // which made /book fail to render as soon as one book had no subtitle.
  if (subtitle !== null) listBook.subtitle = subtitle;
  if (topics !== null) listBook.topics = topics;
  if (isbn !== null) listBook.isbn = isbn;
  if (userId !== null) listBook.userId = userId;

  const copyCount = trimmedIsbn ? copyCountsByIsbn.get(trimmedIsbn) : undefined;
  if (copyCount !== undefined) listBook.copyCount = copyCount;

  return listBook;
}

/**
 * The book id an all-digits query names, if any.
 *
 * A barcode scanner types the id, so an exact hit has to come first. Leading
 * zeros are stripped because scanners pad them.
 */
export function exactIdFromQuery(query: string): number | null {
  const q = query.trim();
  if (!/^\d+$/.test(q)) return null;
  const id = parseInt(q.replace(/^0+/, "") || q, 10);
  return Number.isFinite(id) ? id : null;
}

/**
 * Fetches one page with the exact id match pinned to the very top.
 *
 * Ranking has to happen before the page is cut, not after. Ordering by id and
 * paginating put the book someone actually scanned wherever it happened to
 * fall: searching "12" returned 41 books with number 12 not even on the first
 * page. Reordering the fetched page cannot fix that, because the row is not on
 * it. So the match is looked up separately and the rest of the page is filled
 * around it, which keeps the total and the page arithmetic honest.
 */
async function findPagePinningExactId<T>(
  client: PrismaClient,
  {
    where,
    exactId,
    page,
    pageSize,
    orderBy,
    select,
  }: {
    where: Prisma.BookWhereInput | undefined;
    exactId: number | null;
    page: number;
    pageSize: number;
    orderBy:
      | Prisma.BookOrderByWithRelationInput
      | Prisma.BookOrderByWithRelationInput[];
    select: any;
  },
): Promise<T[]> {
  const skip = (page - 1) * pageSize;

  if (exactId === null) {
    return (await client.book.findMany({
      select,
      where,
      orderBy,
      skip,
      take: pageSize,
    })) as T[];
  }

  // Only pin it when the row is really in the result set.
  const pinned = await client.book.findUnique({
    select,
    where: { id: exactId },
  });
  const pinnedMatches =
    pinned !== null &&
    (await client.book.count({
      where: { AND: [...(where ? [where] : []), { id: exactId }] },
    })) > 0;

  if (!pinnedMatches) {
    return (await client.book.findMany({
      select,
      where,
      orderBy,
      skip,
      take: pageSize,
    })) as T[];
  }

  const rest = { AND: [...(where ? [where] : []), { id: { not: exactId } }] };

  if (page === 1) {
    const others = (await client.book.findMany({
      select,
      where: rest,
      orderBy,
      skip: 0,
      take: pageSize - 1,
    })) as T[];
    return [pinned as T, ...others];
  }

  // Later pages are shifted by the one row that was lifted onto page one.
  return (await client.book.findMany({
    select,
    where: rest,
    orderBy,
    skip: skip - 1,
    take: pageSize,
  })) as T[];
}

/**
 * A book and every other copy of it, as one row.
 *
 * Copies share an ISBN; a book without one is its own group, since there is
 * nothing to match it on. The representative is an available copy where one
 * exists, so a title with three copies out on loan and one on the shelf reads
 * as available rather than rented.
 */
type BookGroup = { representativeId: number; copyCount: number };

/**
 * Groups the whole result set, then returns the requested page of groups.
 *
 * Grouping has to happen before the page is cut. Doing it per page made the
 * page counter lie: with 25 to a page this library had nine groups straddling
 * a boundary, and one page collapsed 25 books into four rows while still
 * claiming to be one page of twenty-five.
 *
 * Reads four narrow columns of the matching rows and groups them in memory,
 * the same shape as the facet counting, which keeps one implementation of the
 * filter rather than a second one written in SQL. That is a deliberate trade
 * for a school library of hundreds to a few thousand books; it would not suit
 * a catalogue orders of magnitude larger.
 */
async function groupMatchingBooks(
  client: PrismaClient,
  where: Prisma.BookWhereInput | undefined,
  orderBy:
    Prisma.BookOrderByWithRelationInput | Prisma.BookOrderByWithRelationInput[],
  // A scanned copy speaks for its own group even when a sibling is available:
  // someone holding book 12 wants to see book 12, not another copy of it.
  exactId: number | null = null,
): Promise<BookGroup[]> {
  const rows = await client.book.findMany({
    where,
    orderBy,
    select: { id: true, isbn: true, rentalStatus: true },
  });

  const groups = new Map<string, BookGroup & { hasAvailable: boolean }>();
  for (const row of rows) {
    const isbn = row.isbn?.trim();
    // Without an ISBN there is nothing to group on, so the book stands alone.
    const key = isbn ? `isbn:${isbn}` : `id:${row.id}`;
    const available = row.rentalStatus === "available";
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        representativeId: row.id,
        copyCount: 1,
        hasAvailable: available,
      });
      continue;
    }

    existing.copyCount += 1;
    if (row.id === exactId) {
      existing.representativeId = row.id;
      existing.hasAvailable = available;
    } else if (
      available &&
      !existing.hasAvailable &&
      existing.representativeId !== exactId
    ) {
      // Otherwise prefer an available copy to speak for the group.
      existing.representativeId = row.id;
      existing.hasAvailable = true;
    }
  }

  return Array.from(groups.values(), ({ representativeId, copyCount }) => ({
    representativeId,
    copyCount,
  }));
}

/** Moves the group holding an exactly matched id to the front. */
function pinGroupWithId(groups: BookGroup[], exactId: number | null) {
  if (exactId === null) return groups;
  const index = groups.findIndex((g) => g.representativeId === exactId);
  if (index <= 0) return groups;
  return [groups[index], ...groups.slice(0, index), ...groups.slice(index + 1)];
}

/**
 * Where one volume sits among the other copies of the same title.
 *
 * Grouping the lists made this necessary: a card now stands for a title, so
 * opening it used to be a dead end at one arbitrary copy with no way to reach
 * the other thirty-four. Null when the book stands alone, either because the
 * library holds a single copy or because it has no ISBN to match siblings on,
 * so the caller can leave the whole thing out rather than render "1 von 1".
 */
export type CopySiblings = {
  position: number;
  total: number;
  availableCount: number;
  previousId: number | null;
  nextId: number | null;
};

export async function getCopySiblings(
  client: PrismaClient,
  bookId: number,
): Promise<CopySiblings | null> {
  const book = await client.book.findUnique({
    where: { id: bookId },
    select: { isbn: true },
  });

  const isbn = book?.isbn?.trim();
  if (!isbn) return null;

  const copies = await client.book.findMany({
    where: { isbn },
    orderBy: { id: "asc" },
    select: { id: true, rentalStatus: true },
  });

  if (copies.length < 2) return null;

  const index = copies.findIndex((c) => c.id === bookId);
  if (index === -1) return null;

  return {
    position: index + 1,
    total: copies.length,
    availableCount: copies.filter((c) => c.rentalStatus === "available").length,
    previousId: index > 0 ? copies[index - 1].id : null,
    nextId: index < copies.length - 1 ? copies[index + 1].id : null,
  };
}

/**
 * How many copies of each ISBN the library holds, regardless of the filter.
 *
 * The count on a card answers "how many of this book do we have", so it must
 * not change with how you searched. Counting within the filtered set made an
 * id search read as one copy when the shelf held thirty-five, because only the
 * scanned volume matched the query.
 */
async function getLibraryCopyCounts(
  client: PrismaClient,
  isbns: string[],
): Promise<Map<string, number>> {
  const wanted = Array.from(new Set(isbns.filter(Boolean)));
  if (wanted.length === 0) return new Map();

  const counts = await client.book.groupBy({
    by: ["isbn"],
    where: { isbn: { in: wanted } },
    _count: { _all: true },
  });

  return new Map(
    counts.map((row) => [row.isbn?.trim() ?? "", row._count._all]),
  );
}

export async function getPagedBooks(
  client: PrismaClient,
  {
    page,
    pageSize,
    query = "",
    topics = [],
  }: { page: number; pageSize: number; query?: string; topics?: string[] },
): Promise<PagedBooks> {
  const where = withTopics(getBookWhere(query), topics);
  const exactId = exactIdFromQuery(query);

  try {
    const groups = pinGroupWithId(
      await groupMatchingBooks(client, where, [{ id: "desc" }], exactId),
      exactId,
    );
    const pageGroups = groups.slice((page - 1) * pageSize, page * pageSize);

    const [unordered, facets] = await Promise.all([
      client.book.findMany({
        select: listBookSelect,
        where: { id: { in: pageGroups.map((g) => g.representativeId) } },
      }),
      getTopicFacets(client, where),
    ]);

    const libraryCounts = await getLibraryCopyCounts(
      client,
      unordered.map((b) => b.isbn?.trim() ?? ""),
    );

    // findMany returns its own order; the page order is the grouped one.
    const byId = new Map(unordered.map((b) => [b.id, b]));
    const rawBooks = pageGroups
      .map((g) => byId.get(g.representativeId))
      .filter((b): b is (typeof unordered)[number] => b !== undefined);
    const total = groups.length;

    return {
      books: rawBooks.map((book) => {
        const listBook = toListBook(book);
        const isbn = book.isbn?.trim();
        listBook.copyCount = isbn ? (libraryCounts.get(isbn) ?? 1) : 1;
        return listBook;
      }),
      total,
      page,
      pageSize,
      facets,
    };
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "getPagedBooks",
          error: e instanceof Error ? e.message : String(e),
        },
        "Error getting paged books",
      );
    }
    throw e;
  }
}

export async function getBook(client: PrismaClient, id: number) {
  return await client.book.findUnique({ where: { id } });
}

export async function getAllTopics(client: PrismaClient) {
  try {
    return await client.book.findMany({
      select: {
        topics: true,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "getAllTopics",
          error: e instanceof Error ? e.message : String(e),
        },
        "Error getting all topics",
      );
    }
    throw e;
  }
}

export async function getAllBooks(client: PrismaClient) {
  try {
    return await client.book.findMany({
      orderBy: [
        {
          id: "desc",
        },
      ],
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "getAllBooks",
          error: e instanceof Error ? e.message : String(e),
        },
        "Error getting all books",
      );
    }
    throw e;
  }
}

export async function getPublicBooks(
  client: PrismaClient,
): Promise<PublicBookType[]> {
  try {
    const rawBooks = await client.book.findMany({
      select: publicBookSelect,
      orderBy: { title: "asc" },
    });

    return rawBooks.map(toPublicBook);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "getPublicBooks",
          error: e instanceof Error ? e.message : String(e),
        },
        "Error getting public books",
      );
    }
    throw e;
  }
}

export async function getPagedPublicBooks(
  client: PrismaClient,
  {
    page,
    pageSize,
    query = "",
    topics = [],
  }: { page: number; pageSize: number; query?: string; topics?: string[] },
): Promise<PagedPublicBooks> {
  const where = withTopics(getPublicBookWhere(query), topics);
  const exactId = exactIdFromQuery(query);

  try {
    const groups = pinGroupWithId(
      await groupMatchingBooks(client, where, { title: "asc" }, exactId),
      exactId,
    );
    const pageGroups = groups.slice((page - 1) * pageSize, page * pageSize);

    const [unordered, facets] = await Promise.all([
      client.book.findMany({
        select: publicBookSelect,
        where: { id: { in: pageGroups.map((g) => g.representativeId) } },
      }),
      getTopicFacets(client, where),
    ]);

    const libraryCounts = await getLibraryCopyCounts(
      client,
      unordered.map((b) => b.isbn?.trim() ?? ""),
    );

    // findMany returns its own order; the page order is the grouped one.
    const byId = new Map(unordered.map((b) => [b.id, b]));
    const rawBooks = pageGroups
      .map((g) => byId.get(g.representativeId))
      .filter((b): b is (typeof unordered)[number] => b !== undefined);

    return {
      books: rawBooks.map((book) => {
        const isbn = book.isbn?.trim();
        return {
          ...toPublicBook(book),
          copyCount: isbn ? (libraryCounts.get(isbn) ?? 1) : 1,
        };
      }),
      total: groups.length,
      page,
      pageSize,
      facets,
    };
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "getPagedPublicBooks",
          error: e instanceof Error ? e.message : String(e),
        },
        "Error getting paged public books",
      );
    }
    throw e;
  }
}

export async function getRentedBooksWithUsers(client: PrismaClient) {
  try {
    return await client.book.findMany({
      where: {
        rentalStatus: {
          contains: "rented",
        },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        author: true,
        renewalCount: true,
        rentedDate: true,
        user: {
          select: {
            lastName: true,
            firstName: true,
            schoolGrade: true,
            id: true,
          },
        },
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "getRentedBooksWithUsers",
          error: e instanceof Error ? e.message : String(e),
        },
        "Error getting rented books with users",
      );
    }
    throw e;
  }
}

export async function getRentedBooksForUser(client: PrismaClient, id: number) {
  try {
    return await client.book.findMany({
      where: {
        rentalStatus: {
          contains: "rented",
        },
        userId: {
          equals: id,
        },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        rentedDate: true,
        renewalCount: true,
        user: {
          select: {
            lastName: true,
            firstName: true,
            schoolGrade: true,
            id: true,
          },
        },
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "getRentedBooksForUser",
          userId: id,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error getting rented books for user",
      );
    }
    throw e;
  }
}

export async function countBook(client: PrismaClient) {
  try {
    return await client.book.count({});
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "countBook",
          error: e instanceof Error ? e.message : String(e),
        },
        "Error counting books",
      );
    }
    throw e;
  }
}

export async function addBook(client: PrismaClient, book: BookType) {
  businessLogger.debug(
    {
      event: LogEvents.BOOK_CREATED,
      bookId: book.id,
      title: book.title,
    },
    "Adding book",
  );
  try {
    addAudit(client, "Add book", book.title, book.id);
    return await client.book.create({
      data: { ...book },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "addBook",
          bookId: book.id,
          title: book.title,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error creating a new book",
      );
    }
    throw e;
  }
}

export async function updateBook(
  client: PrismaClient,
  id: number,
  book: BookType,
) {
  businessLogger.debug(
    {
      event: LogEvents.BOOK_UPDATED,
      bookId: id,
      title: book.title,
    },
    "Updating book",
  );
  const { id: _id, userId: _userId, ...bookData } = book; //apparently in prisma 7, the id should not be included in the data itself
  try {
    await addAudit(
      client,
      "Update book",
      book.id ? book.id.toString() + ", " + book.title : "undefined",
      id,
    );

    // Invariant: a book may only stay connected to a user while it's
    // actually "rented". If the status is being explicitly changed to
    // anything else (lost, broken, available, ...), sever the connection
    // too - otherwise the book keeps a dangling userId and gets
    // cascade-deleted if that user is later removed, even though it's no
    // longer their book. A partial update that omits rentalStatus must NOT
    // sever an active rental, hence the undefined check.
    const severConnection =
      bookData.rentalStatus !== undefined && bookData.rentalStatus !== "rented";

    // Interactive transaction: the userId read, the disconnect, the book
    // update, and the audit entry commit (or roll back) together, so the
    // audit trail can never claim a disconnect that didn't happen.
    const { updatedBook, disconnectedUserId } = await client.$transaction(
      async (tx) => {
        let disconnectedUserId: number | null = null;

        if (severConnection) {
          const current = await tx.book.findUnique({
            where: { id },
            select: { userId: true },
          });

          if (current?.userId) {
            await tx.user.update({
              where: { id: current.userId },
              data: {
                books: {
                  disconnect: { id },
                },
              },
            });
            disconnectedUserId = current.userId;

            await addAudit(
              tx,
              "Update book - rental connection severed",
              `book id ${id}, ${book.title}, status changed to "${bookData.rentalStatus}", disconnected from user id ${current.userId}`,
              id,
              current.userId,
            );
          }
        }

        const updatedBook = await tx.book.update({
          where: {
            id,
          },
          data: { ...bookData },
        });

        return { updatedBook, disconnectedUserId };
      },
    );

    if (disconnectedUserId !== null) {
      businessLogger.info(
        {
          event: LogEvents.BOOK_UPDATED,
          bookId: id,
          userId: disconnectedUserId,
          newRentalStatus: bookData.rentalStatus,
        },
        "Book status changed away from 'rented' - severed user connection",
      );
    }

    return updatedBook;
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "updateBook",
          bookId: id,
          title: book.title,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error updating a book",
      );
    }
    throw e;
  }
}

export async function deleteBook(client: PrismaClient, id: number) {
  try {
    await addAudit(client, "Delete book", id.toString(), id);
    const deletedBook = await client.book.delete({
      where: {
        id,
      },
    });

    const storagePath = process.env.COVERIMAGE_FILESTORAGE_PATH;

    if (storagePath) {
      const fileName = `${id}.jpg`;
      const filePath = path.join(storagePath, fileName);

      try {
        // Löschversuch der .jpg Datei
        await fs.unlink(filePath);
      } catch (fileError: any) {
        // Falls die Datei gar nicht existiert, ignorieren.
        if (fileError.code !== "ENOENT") {
          errorLogger.warn(
            {
              bookId: id,
              error: fileError.message,
              path: filePath,
            },
            "Bilddatei konnte nicht gelöscht werden",
          );
        }
      }
    }
    return deletedBook;
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "deleteBook",
          bookId: id,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error deleting one book",
      );
    }
    throw e;
  }
}

export async function deleteAllBooks(client: PrismaClient) {
  try {
    return await client.book.deleteMany({});
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "deleteAllBooks",
          error: e instanceof Error ? e.message : String(e),
        },
        "Error deleting all books",
      );
    }
    throw e;
  }
}

export async function extendBook(
  client: PrismaClient,
  bookid: number,
  days: number,
) {
  try {
    const book = await getBook(client, bookid);
    if (!book?.dueDate) return null; // you can't extend a book without a due date

    //
    // this was using the last due date instead of today
    // const updatedDueDate = dayjs(book.dueDate).add(days, "day").toISOString();
    const updatedDueDate = dayjs().add(days, "day").toISOString();
    const updatedBook = await client.book.update({
      where: { id: bookid },
      data: { renewalCount: { increment: 1 }, dueDate: updatedDueDate },
    });

    await addAudit(
      client,
      "Extend book",
      "book id " + bookid.toString() + ", " + book.title,
      bookid,
    );

    return updatedBook;
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "extendBook",
          bookId: bookid,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error extending a book",
      );
    }
    throw e;
  }
}
export async function returnBook(client: PrismaClient, bookid: number) {
  try {
    //get the user for that book
    const book = (await getBook(client, bookid)) as BookType;
    if (!book.userId) {
      return "ERROR in returning a book, this user does not have a book";
    }
    const userid = book.userId;
    await addAudit(
      client,
      "Return book",
      "book id " + bookid.toString() + ", " + book.title,
      bookid,
    );
    const transaction = [];
    transaction.push(
      client.book.update({
        where: { id: bookid },
        data: {
          renewalCount: 0,
          rentalStatus: "available",
          dueDate: null,
          rentedDate: new Date().toISOString(),
        },
      }),
    );
    transaction.push(
      client.user.update({
        where: { id: userid },
        data: {
          books: {
            disconnect: { id: bookid },
          },
        },
      }),
    );

    return await client.$transaction(transaction);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "returnBook",
          bookId: bookid,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error returning a book",
      );
    }
    throw e;
  }
}

export async function hasRentedBook(
  client: PrismaClient,
  bookid: number,
  userid: number,
) {
  try {
    const book = await client.book.findFirst({ where: { id: bookid } });
    businessLogger.debug(
      {
        event: LogEvents.BOOK_RENTAL_CHECKED,
        userId: userid,
        bookId: bookid,
        rentalStatus: book?.rentalStatus,
        bookUserId: book?.userId,
      },
      "Rent check performed",
    );
    if (book?.userId == userid && book.rentalStatus == "rented") return true;
    else return false;
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "hasRentedBook",
          bookId: bookid,
          userId: userid,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error getting status of a book",
      );
    }
    throw e;
  }
}

export async function rentBook(
  client: PrismaClient,
  userid: number,
  bookid: number,
  duration: number,
) {
  //console.log("Renting book with duration", duration);

  //if the book is rented already, you cannot rent it
  const book = await getBook(client, bookid);
  const user = await getUser(client, userid);

  try {
    if (book?.rentalStatus == "rented") {
      businessLogger.warn(
        {
          event: LogEvents.BOOK_RENTAL_REJECTED,
          bookId: bookid,
          userId: userid,
          reason: "Book already rented",
        },
        "Attempted to rent already rented book",
      );
      return "ERROR, book is rented";
    }
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "rentBook",
          bookId: bookid,
          userId: userid,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error renting a book",
      );
    }
    throw e;
  }
  await addAudit(
    client,
    "Rent book",
    "User id: " +
      userid.toString() +
      " " +
      user?.firstName +
      " " +
      user?.lastName +
      ", Book id: " +
      bookid.toString() +
      ", book title: " +
      book?.title,
    bookid,
    userid,
  );
  const transaction = [];

  transaction.push(
    client.user.update({
      where: {
        id: userid,
      },
      data: {
        books: {
          connect: {
            id: bookid,
          },
        },
      },
    }),
  );
  const now = dayjs();
  const dueDate = now.add(duration, "day");
  transaction.push(
    client.book.update({
      where: { id: bookid },
      data: {
        rentalStatus: "rented",
        renewalCount: 0,
        rentedDate: now.toISOString(),
        dueDate: dueDate.toISOString(),
      },
    }),
  );
  try {
    return await client.$transaction(transaction);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError ||
      e instanceof Prisma.PrismaClientValidationError
    ) {
      errorLogger.error(
        {
          event: LogEvents.DB_ERROR,
          operation: "rentBook",
          bookId: bookid,
          userId: userid,
          error: e instanceof Error ? e.message : String(e),
        },
        "Error renting a book",
      );
    }
    throw e;
  }
}
