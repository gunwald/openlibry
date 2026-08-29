#!/usr/bin/env node
/**
 * Measures how much a page costs the browser: JS heap, the size of the data
 * Next.js embeds in the server-rendered HTML, and how many book records that
 * data contains.
 *
 * Used to compare client-side and server-side catalog rendering. Because it
 * only talks to a running server over the DevTools protocol, it is independent
 * of which branch is checked out: build and start a server, then point this at
 * it, then repeat on the other branch.
 *
 * No dependencies. Needs Node 22+ (for the global WebSocket) and a
 * Chromium-based browser. Firefox will not work, performance.memory is
 * Chromium-only.
 *
 *   node scripts/bench/measure-page-memory.mjs --url http://localhost:3000/catalog
 *   node scripts/bench/measure-page-memory.mjs --url ... --label main-2000 --json
 *
 * Options:
 *   --url <url>       page to measure (required)
 *   --label <text>    label for the output row (default: the url)
 *   --settle <ms>     wait after navigation, must cover the search index
 *                     build, which happens after first paint (default 8000)
 *   --repeats <n>     measure n times and report each (default 1)
 *   --browser <path>  browser binary, or "flatpak:<app-id>"
 *   --cdp <url>       attach to an already running browser instead of
 *                     launching one, e.g. http://127.0.0.1:9222
 *   --json            emit JSON instead of a table row
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const url = opt("url");
if (!url) {
  console.error("--url is required. See the header of this file for usage.");
  process.exit(2);
}
const label = opt("label", url);
const settleMs = Number(opt("settle", 8000));
const repeats = Number(opt("repeats", 1));
const asJson = flag("json");

const CANDIDATES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function resolveBrowser() {
  const explicit = opt("browser");
  if (explicit) return explicit;
  for (const c of CANDIDATES) {
    if (c.startsWith("/") ? existsSync(c) : true) {
      // Non-absolute candidates are resolved by the shell when spawned; we
      // cannot cheaply probe them here, so absolute paths win first.
      if (c.startsWith("/") && existsSync(c)) return c;
    }
  }
  return CANDIDATES[0];
}

async function launchBrowser(port, profileDir) {
  const spec = resolveBrowser();
  const chromeArgs = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ];
  const [cmd, argv] = spec.startsWith("flatpak:")
    ? ["flatpak", ["run", spec.slice("flatpak:".length), ...chromeArgs]]
    : [spec, chromeArgs];

  const child = spawn(cmd, argv, { stdio: "ignore", detached: false });
  child.on("error", (e) => {
    console.error(
      `Could not start the browser (${cmd}). Pass --browser <path> or ` +
        `--browser flatpak:<app-id>, or run one yourself and use --cdp.\n${e.message}`,
    );
    process.exit(2);
  });
  return child;
}

async function waitForCdp(base, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no DevTools endpoint at ${base}`);
}

async function firstPageTarget(base) {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`${base}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no page target");
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const state = { transferred: 0 };

  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === "Network.loadingFinished") {
      state.transferred += msg.params.encodedDataLength || 0;
    }
  };

  const ready = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  return { ws, send, state, ready };
}

async function measureOnce(session) {
  const { send, state } = session;

  // Cold load, so the byte count reflects a first visit.
  await send("Network.clearBrowserCache");
  await send("Network.clearBrowserCookies");
  await send("Page.navigate", { url: "about:blank" });
  await new Promise((r) => setTimeout(r, 300));

  state.transferred = 0;
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, settleMs));

  // Force a collection so the heap figure is not dominated by garbage that
  // simply has not been reclaimed yet.
  await send("HeapProfiler.collectGarbage");
  await new Promise((r) => setTimeout(r, 800));

  const ev = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true }))
      .result?.value;

  const jsHeapBytes = await ev("performance.memory?.usedJSHeapSize ?? -1");
  const nextDataChars = await ev(
    `document.getElementById("__NEXT_DATA__")?.textContent.length ?? -1`,
  );
  const booksInNextData = await ev(`(() => {
    try {
      const d = JSON.parse(document.getElementById("__NEXT_DATA__").textContent);
      const p = d.props?.pageProps ?? {};
      const arr = p.books ?? p.initialBooks ?? p.rawBooks ?? null;
      return Array.isArray(arr) ? arr.length : -1;
    } catch { return -1; }
  })()`);
  const renderedCards = await ev(
    `document.querySelectorAll("[data-cy^=book_summary_card_]").length`,
  );

  return {
    label,
    url,
    jsHeapBytes,
    nextDataChars,
    booksInNextData,
    renderedCards,
    transferredBytes: state.transferred,
  };
}

const port = Number(opt("port", 9222));
const attachTo = opt("cdp");
let child = null;
let profileDir = null;

try {
  const base = attachTo ?? `http://127.0.0.1:${port}`;
  if (!attachTo) {
    profileDir = await mkdtemp(join(tmpdir(), "openlibry-bench-"));
    child = await launchBrowser(port, profileDir);
  }
  await waitForCdp(base);

  const page = await firstPageTarget(base);
  const session = connect(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Network.enable");
  await session.send("Page.enable");
  await session.send("HeapProfiler.enable");

  const results = [];
  for (let i = 0; i < repeats; i++) results.push(await measureOnce(session));

  if (asJson) {
    console.log(JSON.stringify(repeats === 1 ? results[0] : results, null, 2));
  } else {
    for (const r of results) {
      const mb = (n) => (n / 1048576).toFixed(1).padStart(5);
      const kb = (n) => (n / 1024).toFixed(1).padStart(7);
      console.log(
        `${String(r.label).padEnd(16)} heap=${mb(r.jsHeapBytes)} MB  ` +
          `data-in-html=${kb(r.nextDataChars)} KB  ` +
          `books-shipped=${String(r.booksInNextData).padStart(5)}  ` +
          `cards=${String(r.renderedCards).padStart(3)}  ` +
          `transferred=${kb(r.transferredBytes)} KB`,
      );
    }
  }
  session.ws.close();
} finally {
  if (child) child.kill();
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
