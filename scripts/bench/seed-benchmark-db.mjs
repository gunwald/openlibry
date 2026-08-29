#!/usr/bin/env node
/**
 * Builds a benchmark database of a given size by cloning the books already in
 * a source database, so field lengths stay realistic rather than synthetic.
 *
 * Never point this at a production database. It writes to a copy and refuses
 * to overwrite an existing target.
 *
 *   node scripts/bench/seed-benchmark-db.mjs \
 *     --from database/dev.db --to /tmp/bench-2000.db --books 2000
 *
 * Note that cloned rows compress unusually well, so gzipped transfer sizes
 * measured against this data understate the difference a real catalogue would
 * show. The uncompressed payload is the fairer comparison.
 */

import { copyFile, access } from "node:fs/promises";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};

const from = opt("from", "database/dev.db");
const to = opt("to");
const target = Number(opt("books", 2000));

if (!to) {
  console.error("--to is required (path for the benchmark database)");
  process.exit(2);
}

const exists = async (p) => access(p).then(() => true).catch(() => false);
if (await exists(to)) {
  console.error(`${to} already exists, refusing to overwrite it`);
  process.exit(2);
}

await copyFile(from, to);
const url = `file:${resolve(to)}`;
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const seed = await prisma.book.findMany({ orderBy: { id: "asc" } });
if (seed.length === 0) {
  console.error(`${from} contains no books to clone`);
  process.exit(2);
}

let count = await prisma.book.count();
let n = 0;
while (count < target) {
  const src = seed[n % seed.length];
  const { id, createdAt, updatedAt, userId, ...rest } = src;
  await prisma.book.create({
    data: {
      ...rest,
      title: `${src.title} (Ex. ${n + 2})`,
      // Keep clones unrented so they do not reference users that may not
      // exist. rentedDate is not nullable, so it keeps the source value.
      rentalStatus: "available",
      dueDate: null,
      renewalCount: 0,
    },
  });
  count++;
  n++;
}

console.log(`${to}: ${await prisma.book.count()} books (cloned from ${seed.length})`);
await prisma.$disconnect();
