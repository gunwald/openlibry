# Backlog

Deferred items to tackle on their own branches. Each entry: where, what, why
it's parked here rather than fixed in the branch that surfaced it.

## Code-review findings deferred from the AI-tagging branch (441-ai-tag-suggestions)

These came out of a review of `441-ai-tag-suggestions` but are **not** part of
that feature — they live in pre-existing code or in unrelated commits that rode
on the branch. Fix them separately so the feature branch stays scoped.

### Repo-wide tech debt

- **Topic (de)serialization is duplicated across ~6 sites.** The
  `split(";") → trim → filter` / `join(";")` contract for the `Book.topics`
  string is re-implemented in `lib/utils/getUniqueTopics.ts`,
  `lib/utils/topicUtils.ts`, `pages/catalog.tsx`, `pages/book/batchscan.tsx`,
  the label renderers, and now `components/book/edit/BookTopicsChips.tsx`.
  There is no single owner for the semicolon delimiter, so a delimiter or
  trimming change can't propagate. → Introduce shared
  `parseTopics`/`serializeTopics` in `lib/utils/topicUtils.ts` and replace the
  ad-hoc `split(";")`/`join(";")` sites with it.

### Unrelated changes that rode in on the branch

- **`pages/rental/index.tsx` — `mutate()` placement.** In
  `handleRentBookButton`, the `!res.ok` path returns early before the SWR
  `mutate()`, so a handled server error (e.g. 409 already rented) skips
  revalidation while the success and exception paths revalidate. → Move
  `mutate()` so the list refreshes on non-OK responses too.

- **`pages/book/batchscan.tsx` — hardcoded German toasts.** The camera-scanner
  base (lines ~91, 167, 170, 192, 289, 292, 307, 394, 401, 420) uses literal
  German strings instead of `t(...)`, so non-German installs see untranslated
  toasts. → Route them through the i18n dictionary. (The AI-tagging toast at
  ~508 is fixed on the feature branch; these pre-existing ones are not.)

- **`pages/api/db/reconnect.ts` deletion.** Removed by a test-infra commit
  ("fixing tests with seeding data"), unrelated to AI tagging. Verified safe
  (nothing references `/api/db/reconnect`; `LogEvents.DB_RECONNECTED` and
  `entities/db.ts` `reconnectPrisma()` are separate and intact). No action
  needed beyond noting the scope mix; listed for traceability.

## AI-tagging feature ideas (parked — need validation before shipping)

- **Cross-domain specificity prompt rule ("3b").** A SYSTEM_PROMPT bullet telling
  the model that a broad domain tag (e.g. `Kunstgeschichte`) belongs only on a
  book genuinely *about* that domain, not on a general history/archaeology work
  that merely touches it — and not just because neighbour books carry it. The
  motivating failure (`Kunstgeschichte` leaking onto world-history books) is
  **stochastic**: it showed up in one manual run but did not reproduce across
  four graded benchmark runs (enriched and cold, with and without the rule), so
  the rule had **no measurable effect** and was dropped rather than shipped
  unvalidated. → Before re-adding, build an **N-run leak-frequency harness**
  (run the leak-prone rows ~10× each, count how often the bad tag appears) so a
  stochastic fix can be measured against a stochastic baseline. Only re-add the
  rule if it cuts the measured leak rate without lowering must-include recall.
  Context: evidence-tier reconciliation + the Region/grounding off-style
  carve-out already shipped on `441-ai-tag-suggestions` (commit `a9ade92`).
