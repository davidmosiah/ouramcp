## 0.7.3 - 2026-09-01

### Fixed

- **Doctor no longer fails after a full Oura consent** (#11). Oura now returns granted scopes with an `extapi:` prefix (`extapi:daily`, `extapi:heartrate`, …). Scope canonicalization strips that wire prefix so recommended scopes still match, including aliases such as `extapi:spo2Daily` → `spo2`. Unprefixed grants remain valid.

## 0.7.2 - 2026-08-29

Skill layer ships in-package (`skill/SKILL.md`). Agents can use MCP tools **or** `call <tool> --json` on the same binary; mutation gates stay identical.

## 0.7.1 - 2026-08-26

### Security

- OAuth authorization now uses PKCE S256 and 128-bit state.

## 0.7.0 - 2026-08-13

### Fixed

- **Collection tools no longer advertise a fake integer page.** Oura v2 paginates with an
  opaque `next_token` cursor. `page` (input) and `next_page` (output) were decorative: the
  number was never sent upstream, and incrementing it could not resume or skip to a later
  block. Agents that looped on `page = next_page` could fetch the same oldest page forever
  or believe they had walked a window they had not. Tracked as `TODO(next_page)` since 0.6.0.

### Changed

- **`oura_list_*` now pass the real cursor through.** Input `next_token` is forwarded to
  Oura as `next_token`. Output `next_token` is the upstream cursor, returned only when it
  is safe to resume without skipping records (`truncated` is false). When the local `limit`
  cap dropped already-fetched rows, `truncated` is true, `has_more` is true, and
  `next_token` is omitted — raise `limit` or set `all_pages` instead of following a cursor.
- `page` is removed from the collection input schema. A leftover `page` other than `1`
  (the old default) is rejected with an error that names `next_token`, so a cached agent
  loop cannot silently no-op.
- Agent manifest rules, Hermes skill, capabilities flow and `docs/pagination.md` describe
  the same contract: `has_more`, `next_token`, `truncated`, `limit` (oldest-end cap).

### Added

- `test:pagination-limit` round 4: resume via `next_token` actually advances the synthetic
  cursor; a truncated slice omits `next_token`; the tool schema has `next_token` and not
  `page` / `next_page`. Still synthetic fixtures only — no live Oura token.

## 0.6.1 - 2026-08-01

### Fixed

- **Eight of the nine `oura_list_*` tools stopped sending agents to readiness data.** The
  `limit` description lives in the shared collection schema, so the recency pointer added
  in 0.6.0 — "read the resource `oura://latest/readiness`" — was served identically by
  `oura_list_sleep`, `oura_list_workouts`, `oura_list_heartrate` and the rest. An agent
  asking "how did I sleep last night", correctly warned that `limit: 1` returns the
  *oldest* record, was then routed to a resource that only holds readiness. The pointer is
  now per tool: readiness names its resource, and the other eight say plainly that no
  latest-record shortcut exists for their domain and give the route that does work —
  narrow the window with `after`/`before` until `truncated` and `has_more` are both false,
  at which point the last record returned is the newest in that window.
- The `limit` description already named the oldest end in 0.6.0; that stays, now stated on
  every one of the nine tools with the correct per-domain recency route beside it.

### Changed

- Nothing at runtime. `limit` remains an oldest-end cap: Oura serves collections
  oldest-first behind an opaque forward cursor with no sort parameter, so "the k most
  recent" cannot be answered without walking the whole window to its end first — that
  would turn a one-page list call into an N-page scan and break the `page`/`next_page`
  contract, which pages the same oldest-first order. Recency stays a separate, explicit
  call (`oura://latest/readiness`), and the schema now points at it only where it exists.
- Latest-record resources for the other eight domains were considered and deliberately not
  added here: for the daily domains it is straightforward, but `heartrate` is a
  high-cardinality time series where a 14-day cursor walk blows past the 20-page scan
  budget and would return `most_recent_guaranteed: false` as the normal case. Shipping
  half a family of resources reads as a rule with an unexplained hole, so the tools say
  clearly that only readiness has one.

## 0.6.0 - 2026-08-01

### Fixed

- **`oura://latest/readiness` is now the newest record by construction, not by luck of the
  window size.** 0.5.0 made the resource singular but still read a single page: one
  `list()` call, no pagination. Since Oura serves collections oldest-first, the newest
  record lives on the *last* page — so the resource was returning the newest of the
  *oldest block*. Measured on 250 records served in pages of 40: it answered record 40 and
  labelled it "Most recent". Today's daily-readiness window usually fits in one page, so
  the contract was being honoured by data shape, not by code. The resource now asks for a
  short recent window (14 days) and walks that window's cursor **to exhaustion**, keeping
  only the newest record seen, so the answer no longer depends on where Oura puts a page
  boundary. If the narrow window comes back empty it widens (14 → 90 → 400 days), so a
  ring that has not synced in weeks still answers instead of reporting nothing.
- **The `limit` schema now says which end it cuts.** `limit` keeps the *k oldest* records
  of the window, and the description ("Maximum number of records returned by this call")
  was true but silent about that. An agent passing `limit: 1` to see "my latest readiness"
  got the **oldest** record — the same trap that produced the 0.5.0 resource defect, still
  live in the one artifact an agent actually reads. The description now names the oldest
  end explicitly and points at `oura://latest/readiness` for recency.

### Changed

- `oura://latest/readiness` gains `lookback_days`, `pages_scanned` and
  `most_recent_guaranteed` alongside `records`. `most_recent_guaranteed: false` means the
  20-page runaway guard fired mid-window, so the record is the newest *seen* rather than
  provably the newest — the guard reports itself instead of truncating silently. This
  additive output-contract change is what the minor bump is for.
- **`limit` behaviour is deliberately unchanged: it stays an oldest-end cap.** Making it
  return the *k most recent* was considered and rejected. Oura v2 has no sort parameter, so
  "k most recent" is only obtainable by paginating the entire window — which would make
  every list call expensive — or by taking the tail of page 1, which is exactly the defect
  fixed above wearing a different hat. Truthful documentation plus a correct dedicated
  resource beats a parameter whose cost or correctness depends on data shape.

### Known, not fixed

- **`page` (input) and `next_page` (output) are decorative.** Oura v2 paginates by opaque
  `next_token` cursor, so a page *number* cannot be sent upstream and `next_page` cannot be
  resumed from. Same genre as the `limit`/`has_more` lies fixed in 0.5.0, now standing next
  to flags that are honest. Left in place because removing them is a breaking output-schema
  change; tracked as `TODO(next_page)` in `src/services/oura-client.ts` for the next major,
  which should either drop both fields or expose the real cursor.

### Added

- `test:pagination-limit` gains a **multi-page** fixture (250 synthetic records in pages of
  40) asserting that `oura://latest/readiness` returns record 250 and not record 40, plus
  assertions that the page-budget guard reports `most_recent_guaranteed: false` instead of
  lying, that an empty narrow window widens to the 90-day rung, and that the `limit` schema
  description names the oldest end and the recency resource. Five of these fail on 0.5.0.
  Every record remains synthetic.
- `OuraClient.latest(path, params)` — bounded oldest-first cursor scan returning the single
  newest record with `cursor_exhausted`, `pages_fetched` and `records_scanned`.

## 0.5.0 - 2026-08-01

### Fixed

- **`limit` now actually limits.** The collection tools advertised `limit` (default 30,
  min 1, max 100) as a real parameter, but it was never sent upstream and never truncated
  anything: `limit=1` returned the entire window — 50 of 50 records in the regression
  fixture. An agent asking for one record to keep its context small received the whole
  history and had no way to know the number it passed was decorative. `limit` is now a
  real cap on returned records, applied locally (the Oura v2 API exposes no page-size
  parameter, only `start_date`/`end_date` and the `next_token` cursor), and the schema
  description says exactly that instead of "local page-size hint used for pagination safety".
- **`all_pages` no longer truncates data silently.** Pagination ended on
  `pageRecords.length < limit`, a comparison against a number the Oura API had never seen.
  The effect was inverted: with the *default* `limit=30`, any page smaller than 30 records
  ended the loop after page 1 even with a live `next_token`, so agents summarizing a month
  got a fraction of it and were told `has_more: false`; with a *small* limit the loop ran to
  `max_pages`, so `limit=5` fetched 100 records in 5 HTTP calls while `limit=100` fetched 20
  in one. Pagination now ends on the absence of `next_token` (or on `max_pages`, or once the
  cap is filled) — asking for more never returns less.
- **`oura://latest/readiness` returns one record.** The resource is described as "Most recent
  Oura readiness record" (singular) and returned the whole window — 14 of 14 records, 2690
  bytes instead of one. It now returns exactly the newest record. Note that `limit: 1` alone
  would have returned the *oldest* one, since Oura serves collections oldest-first.

### Changed

- `CollectionOutputSchema` gains `truncated: boolean`, and `has_more` is now true when the
  `limit` cap dropped records — not only when an upstream cursor remains. Previously an agent
  could receive a silently shortened list flagged `has_more: false`. This is the output-contract
  change behind the minor bump.

### Added

- `npm run test:pagination-limit` — regression gate over a synthetic paged Oura API driven by a
  real MCP client, asserting that `limit=k` returns at most `k`, that `all_pages` with the
  default limit follows `next_token` past page 1 and stops when the cursor is exhausted, and
  that `oura://latest/readiness` returns exactly one record — the most recent. Wired into
  `npm test`. Every fixture record is synthetic; no real Oura data is used.

## 0.4.11 - 2026-07-30

### Added / Fixed

- exchange_code description documents explicit user OAuth action (scorecard 100).

# Changelog

## 0.6.3

- Security: raise `hono` override to **4.13.1** (clears moderate MCP SDK transitive advisories); `@hono/node-server@2.1.0`.


## 0.6.2

- Security: override `fast-uri@3.1.5` and `ip-address@10.4.0` (high transitive).




## 0.4.10 - 2026-07-30

### Security

- Agent-requested `privacy_mode=raw` requires `explicit_user_intent=true` (config-default raw still allowed without per-call intent).

## 0.4.9 - 2026-07-30

### Security

- Security: require explicit_user_intent on revoke/disconnect tools so agents cannot wipe OAuth grants autonomously.

## 0.4.8 - 2026-07-30

### Fixed

- **Doctor no longer fails after a full Oura consent** (#8). Recommended scopes dropped the non-existent `sleep` OAuth scope (sleep/readiness/activity are covered by `daily` on Oura's consent screen and OpenAPI). `spo2Daily` (OpenAPI wire name) now satisfies the `spo2` recommendation.
- **Auth callback persists granted scopes.** `auth` now hands the full redirect URL to `exchangeCode` so the `scope` query param is saved; Oura's token endpoint often omits `scope` in the body.
- **Token refresh no longer wipes `scope`.** When a refresh response omits `scope`, the previously stored grant is preserved.

## 0.4.7 - 2026-07-16

### Fixed

- Preserve the caller's calendar date when converting offset ISO date-times to Oura `start_date` and `end_date` query parameters, and reject invalid dates before any HTTP request.
- Log redacted per-domain errors from partial daily and weekly summaries to stderr instead of silently hiding upstream failures.
- Add an executable HTTP-boundary regression suite covering Oura date parameters, invalid-input rejection and response-envelope extraction.
- Guard structured privacy output against future upstream-field loss while continuing to redact GPS and secret-bearing fields.

## 0.4.6 - 2026-05-29

### Docs

- **README Quickstart** — new "see the data before you connect" section documenting `oura_demo`, with the real captured JSON payload for the readiness/sleep/daily-summary tools so agents learn the data contract before OAuth. Added `oura_demo` and `oura_quickstart` to the Tools list.

## 0.4.3 - 2026-05-20

### Added

- **HTTP response cache middleware** (`src/services/http-cache.ts`) — in-memory cache layered OUTSIDE retry (`fetchWithCache → fetchWithRetry → fetch`), so cached responses skip both network and retry. Default 60s TTL for GET only; POST/PUT/DELETE and 4xx/5xx responses are never cached.
- **`OURA_NO_CACHE=true` env var** — global per-process cache bypass; advertised in `server.json`.
- **Per-call `cache_ttl: 0`** request option — opts a single call out of cache without disabling globally.
- **Query-param-order-insensitive cache keys** — `?start_date=…&end_date=…` and `?end_date=…&start_date=…` share one cache entry.
- **`oura_cache_status` now reports `http_cache` stats** alongside SQLite stats: `size`, `hit_count`, `miss_count`, `hit_rate`, `default_ttl_seconds`, `bypass_env_var`.
- `scripts/http-cache-test.mjs` — eight-case unit suite covering cache hit, POST never cached, TTL expiration, query-param normalization, 4xx not cached, env-var bypass, per-call `cache_ttl: 0`, and `getCacheStats()` math.

## 0.4.2 - 2026-05-19

### Added

- **Dedicated HTTP retry middleware** (`src/services/http-retry.ts`) — extracted from `OuraClient.fetchWithRetry` into a reusable, testable function with exponential backoff (500ms / 1s / 2s), ±20% jitter, and `Retry-After` header parsing (supports both seconds and HTTP-date formats).
- **`OURA_NO_RETRY=true` env flag** — disables retries entirely for tests or callers that want raw error propagation.
- **HTTP 408 added to retryable status set** alongside 429, 500, 502, 503, 504 — request-timeout responses are now transparently retried.
- **Network-error retries** — fetch failures (ECONNRESET, ENOTFOUND, timeouts) are now retried with the same backoff schedule as HTTP errors instead of bubbling up on the first failure.
- **Structured stderr logs** — each retry now writes `[oura-mcp] retry N/3 after Xms (status=Y or error=Z)` so agents can correlate spike-and-recovery patterns in their logs.
- `scripts/http-retry-test.mjs` — six-case unit suite covering happy path, Retry-After header, env disable flag, 401 non-retry, exhaustion, and network-error retry.

### Changed

- `OuraClient.fetchWithRetry` now delegates to the shared middleware so the auth-failure 401 re-auth flow benefits from the same backoff guarantees.
- Backoff defers to `Retry-After` first (HTTP standard) and only computes jittered exponential when the header is absent or unparseable.

## 0.4.1 - 2026-05-11

### Fixed

- **Profile-store regex no longer false-positives on common wellness words.** Split `SECRET_PATTERNS` into `SECRET_KEY_PATTERNS` (broad, for field names like `oauth_token`) and `SECRET_VALUE_PATTERNS` (high-specificity, only credential shapes: JWTs, `Bearer <token>`, `sk_live_`, `sk-proj-`, `xoxb-`, `github_pat_`, raw `Authorization:` headers). Previously legitimate text like "5 training sessions per week", "limit cookies", "I need to refresh my approach", or "secret sauce: more sleep" was rejected.
- **Partial-profile reads no longer crash downstream.** `readProfileFile` now structurally merges with `DEFAULT_PROFILE` when legacy Hermes/OpenClaw files lacked sub-objects (goals, devices, training, nutrition, preferences, safety). Previously `buildProfileSummary` and `missingCriticalFields` would throw.
- **Onboarding `privacy_note` no longer hard-codes a single connector path.** Lists multiple example paths so the message reads correctly from every connector.

## 0.4.0 - 2026-05-11

- Add shared Delx wellness profile support, vendored from `delx-wellness/lib/profile-store.ts` into `src/services/profile-store.ts` (no new npm deps; Node built-ins only).
- Add `oura_profile_get` tool — read the shared profile (`~/.delx-wellness/profile.json`), returns summary, missing_critical fields and storage_path. Read-only.
- Add `oura_profile_update` tool — patch the shared profile; requires `explicit_user_intent=true`. Rejects any field that looks like a secret (oauth/token/secret/password/cookie/refresh/api_key/session).
- Add `oura_onboarding` tool — return the 11-question onboarding flow (`en` or `pt-BR`) plus current profile state and missing critical fields. Read-only.
- Add `oura-mcp-server onboarding` CLI command — print the onboarding flow JSON (and a TTY-friendly Markdown summary when stderr is a TTY).
- `recommended_first_calls` now leads with `oura_profile_get` so agents check the shared profile state before walking quickstart.
- Auto-migration from Hermes (`~/.hermes/profiles/delx-wellness/wellness-profile.json`) and OpenClaw (`~/.openclaw-delx-wellness/workspace/wellness-profile.json`) legacy paths to the canonical `~/.delx-wellness/profile.json`.
- Tool count: 24 → 27.

## 0.3.0 - 2026-05-11

- Add `oura_quickstart` tool — personalized 3-step setup walkthrough adapted to current state (env vars set? OAuth token present? what's next?). Returns cross-connector hints to pair with wellness-nourish, wellness-cycle-coach, and wellness-cgm-mcp.
- Add `oura_demo` tool — realistic example payloads of `oura_daily_summary`, `oura_wellness_context`, and `oura_list_daily_readiness` so agents see the contract before any real Oura API call.
- `recommended_first_calls` on the agent manifest now leads with `oura_quickstart` and `oura_demo`.
- Tool count: 22 → 24.

## 0.1.1

- Updated `zod` to `4.4.3` after the initial public repository dependency check.
- Kept package, runtime and MCP registry manifest versions aligned for the first public release line.

## 0.1.0

- Initial Oura MCP implementation.
- Added OAuth setup/auth/doctor CLI with local config and token storage under `~/.oura-mcp/`.
- Added 20 MCP tools, 6 resources and 3 prompts.
- Added Oura Cloud API v2 tools for personal info, readiness, sleep, activity, heart-rate, SpO2, sessions, tags and workouts.
- Added daily and weekly summaries, privacy modes, SQLite cache support, privacy audit, connection status and Hermes agent manifest checks.
