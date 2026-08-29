# Catalog memory benchmark

Tools for answering one question with numbers instead of intuition: how much
does the browser have to hold when the catalog grows?

They talk to a running server over the Chrome DevTools protocol, so they do not
care which branch is checked out. Build and start a server, measure it, switch
branch, measure again.

## Requirements

Node 22 or newer, for the global `WebSocket`. A Chromium-based browser, because
`performance.memory` does not exist in Firefox. No extra npm dependencies.

To use these tools from a branch that does not carry them:

```bash
git checkout bench-catalog-memory -- scripts/bench
```

## Build a benchmark catalog

Clones the books already in a database until it reaches the requested size, so
field lengths stay realistic. It writes to a copy and refuses to overwrite an
existing file, but do not point it at anything you care about.

```bash
node scripts/bench/seed-benchmark-db.mjs \
  --from database/dev.db --to /tmp/bench-2000.db --books 2000
```

## Measure

```bash
DATABASE_URL="file:/tmp/bench-2000.db" AUTH_ENABLED=false \
  npx next start --port 3456 &

node scripts/bench/measure-page-memory.mjs \
  --url http://localhost:3456/catalog --label main-2000 --repeats 3
```

On a Flatpak browser, pass `--browser flatpak:io.github.ungoogled_software.ungoogled_chromium`.
To drive a browser you started yourself, pass `--cdp http://127.0.0.1:9222`.

## What the columns mean

- **heap** is the JavaScript memory the page holds
  (`performance.memory.usedJSHeapSize`), read after a forced garbage
  collection, once the page has settled and the client-side search index has
  been built. That index is built after first paint, which is why `--settle`
  defaults to 8 seconds; lower it and you measure a page that is not finished.
- **data-in-html** is the `__NEXT_DATA__` block Next.js embeds during server
  rendering. This is what the browser must transfer, parse and then keep.
- **books-shipped** is how many book records that block contains, against
  **cards**, how many the page actually displays.
- **transferred** is the sum of encoded response bodies for a cold load.

## Reading the results

Heap is reproducible within a catalog size but jumps between sizes depending on
when V8 collects, so treat it as a trend and lean on the payload figures, which
are exact.

Cloned rows compress far better than a real catalog, so `transferred`
understates the difference real data would show. The uncompressed payload is
the fairer comparison. A database whose `summary` fields are mostly empty will
also understate it.

## Measured on 2026-08-29

`/catalog`, production builds, same database, three runs per point. `main` is
84e9634, `PR` is the server-side pagination branch of #472.

| books | heap main | heap PR | data-in-html main | PR | shipped main / PR |
|---|---|---|---|---|---|
| 500 | 10.2 MB | 4.8 MB | 159 KB | 7 KB | 500 / 20 |
| 1000 | 16.8 MB | 4.8 MB | 326 KB | 7 KB | 1000 / 20 |
| 2000 | 14.3 MB | 4.8 MB | 639 KB | 7 KB | 2000 / 20 |
| 4000 | 18.5 MB | 4.8 MB | 1322 KB | 8 KB | 4000 / 20 |

The payload doubles with the catalog on `main` and stays flat on the branch,
which is the point: what the browser holds stops depending on how many books
the library owns.
