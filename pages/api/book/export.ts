import { getAllBooks } from "@/entities/book";
import { BookType } from "@/entities/BookType";
import { prisma, reconnectPrisma } from "@/entities/db";
import { LogEvents } from "@/lib/logEvents";
import { businessLogger, errorLogger } from "@/lib/logger";
import type { NextApiRequest, NextApiResponse } from "next";

type ErrorData = { result: string };

/**
 * GET /api/book/export
 *
 * Every book in one unpaged array.
 *
 * This is where the old shape of GET /api/book lives on. That endpoint used to
 * return a bare array when no pageSize was given, so its response shape
 * depended on the query string and omitting a parameter read the entire table.
 * It always answers with a page now.
 *
 * Deprecated on purpose: it is unpaged by definition and grows with the
 * library. Prefer /api/book with page and pageSize.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Array<BookType> | ErrorData>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end(`${req.method} Not Allowed`);
  }

  if (process.env.NODE_ENV !== "production") {
    await reconnectPrisma();
  }

  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '</api/book>; rel="successor-version"');

  try {
    const books = (await getAllBooks(prisma)) as Array<BookType>;

    businessLogger.info(
      {
        event: LogEvents.BOOK_LIST_FETCHED,
        count: books.length,
        endpoint: "/api/book/export",
        deprecated: true,
      },
      "Book list exported in full",
    );

    return res.status(200).json(books);
  } catch (error) {
    errorLogger.error(
      {
        event: LogEvents.API_ERROR,
        endpoint: "/api/book/export",
        method: "GET",
        error: error instanceof Error ? error.message : String(error),
      },
      "Error exporting book list",
    );
    return res.status(500).json({ result: "ERROR: " + error });
  }
}
