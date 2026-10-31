import { getPublicBooks } from "@/entities/book";
import { prisma, reconnectPrisma } from "@/entities/db";
import { PublicBookType } from "@/entities/PublicBookType";
import { LogEvents } from "@/lib/logEvents";
import { businessLogger, errorLogger } from "@/lib/logger";
import type { NextApiRequest, NextApiResponse } from "next";

type ErrorData = { result: string };

/**
 * GET /api/public/books/export
 *
 * The whole public catalogue in one unpaged array.
 *
 * This is where the old shape of /api/public/books lives on. That endpoint
 * used to return a bare array when no pageSize was given, so its response
 * shape depended on the query string and omitting a parameter read the entire
 * table. It always answers with a page now, and anything that genuinely wants
 * everything at once asks here instead.
 *
 * Deprecated on purpose: it is unpaged by definition and grows with the
 * library. Prefer /api/public/books with page and pageSize.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Array<PublicBookType> | ErrorData>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end(`${req.method} Not Allowed`);
  }

  if (process.env.NODE_ENV !== "production") {
    await reconnectPrisma();
  }

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '</api/public/books>; rel="successor-version"');

  try {
    const books = await getPublicBooks(prisma);

    businessLogger.info(
      {
        event: LogEvents.BOOK_LIST_FETCHED,
        count: books.length,
        endpoint: "/api/public/books/export",
        deprecated: true,
      },
      "Public book catalog exported in full",
    );

    return res.status(200).json(books);
  } catch (error) {
    errorLogger.error(
      {
        event: LogEvents.API_ERROR,
        endpoint: "/api/public/books/export",
        method: "GET",
        error: error instanceof Error ? error.message : String(error),
      },
      "Error exporting public book catalog",
    );
    return res.status(500).json({ result: "ERROR: " + error });
  }
}
