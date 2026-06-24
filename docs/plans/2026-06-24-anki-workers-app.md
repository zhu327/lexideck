# Anki-compatible Cloudflare Workers vocab app — Implementation Plan

> **For Pi:** Execute this plan using /skill:subagent-driven-development (current session with subagents).

**Goal:** Build a Cloudflare Workers app (Hono) that is a self-hosted Anki-compatible backend: Ankiconnect-compatible API for Yomitan, D1/KV/R2 bindings, Cloudflare Zero Trust auth, FSRS scheduling, an internal review API, an on-demand LLM enrichment endpoint, and a review/quiz PWA.

**Architecture:** Single Worker serves Ankiconnect API (`POST /`), internal review API (`/api/review/*`), LLM endpoint (`/api/notes/:id/enrich`), health (`/api/health`), and PWA static assets (Workers Assets, `GET /`). Each feature is a self-contained Hono sub-app exported from its module; a final wiring task mounts them into `src/index.ts`. Feature tasks verify end-to-end via a test harness that mounts their sub-app + the auth middleware, so they never edit `src/index.ts` (conflict-free parallelism).

**Tech Stack:** TypeScript, Hono, Wrangler, D1, KV, R2, `jose` (Access JWT), `ts-fsrs` (FSRS), Vitest + `@cloudflare/vitest-pool-workers` (Miniflare), Vite (PWA), Biome or ESLint (lint).

## Task Dependency Graph

Tasks marked ✅ AFK can be executed by agents autonomously. No HITL tasks (all decisions locked in brainstorming).

```
Wave 1:  T1 (scaffold+schema+health+infra)
            │
            ├─────────────┬─────────────┬─────────────┐
Wave 2:    T2 (auth)     T3 (srs)      T4 (llm client) T9 (pwa)
            │             │              │
            └────┬────────┘              │
Wave 3:         T5 (anki read) ──┐       │      T7 (review api) ← uses T3
                (needs T1,T2)    │       │      (needs T1,T2,T3)
                       │         │       │
Wave 4:               T6 (anki write) ◄──┘ (needs T5,T3)
                       │
Wave 5:               T8 (llm enrich) ◄──── T4 (needs T6,T4,T2)
                       │
Wave 6:               T10 (wire all + E2E + assets finalize) (needs T2,T5,T6,T7,T8,T9)
```

| Task | Type | Blocked by | Parallelizable with (same wave) |
|------|------|------------|---------------------------------|
| T1 Scaffold + schema + health | AFK | None | — |
| T2 Cloudflare Access auth | AFK | T1 | T3, T4, T9 |
| T3 FSRS scheduling module | AFK | T1 | T2, T4, T9 |
| T4 LLM enrichment client | AFK | T1 | T2, T3, T9 |
| T5 Ankiconnect read actions | AFK | T1, T2 | T7 |
| T6 Ankiconnect write actions | AFK | T5, T3 | — |
| T7 Review API (due/submit/quiz/familiar) | AFK | T1, T2, T3 | T5 |
| T8 LLM enrich endpoint | AFK | T6, T4, T2 | — |
| T9 PWA (review/quiz/familiar UI) | AFK | T1 | T2, T3, T4 |
| T10 App wiring + E2E + assets | AFK | T2, T5, T6, T7, T8, T9 | — |

**File-conflict safety:** Within each wave, tasks touch disjoint files. Shared files (`src/index.ts`, `wrangler.toml`, `package.json`) are owned by T1 and only re-edited by T10 (serial, last). Feature sub-apps live in their own directories; repo functions are split per-entity into separate files so parallel tasks never edit the same file.

---

## Task 1: Scaffold + D1 schema + health endpoint + validation infra

**Type:** AFK
**Blocked by:** None — can start immediately
**Layers touched:** Infra, DB (schema), Adapter (HTTP)

**Goal:** Establish the runnable project skeleton: Hono Worker with a health endpoint that queries D1, all bindings configured, full D1 schema + seed migration, and the TS/Vitest/Wrangler/lint validation toolchain wired and green. Everything else builds on this.

**Acceptance Criteria:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes (health test green)
- [ ] `npx wrangler deploy --dry-run` passes
- [ ] `npm run lint` passes
- [ ] `GET /api/health` returns `{ ok: true, db: "ok" }` (D1 `SELECT 1` reachable) in a Miniflare-backed test
- [ ] D1 migrations apply cleanly to a fresh local D1; default deck "Default" and "Basic" model exist after seed

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `biome.json` (or `.eslintrc.cjs`)
- Create: `src/env.ts`
- Create: `src/index.ts`
- Create: `src/db/client.ts`
- Create: `migrations/0001_init.sql`
- Create: `migrations/0002_seed.sql`
- Create: `dist/pwa/index.html` (placeholder so assets dir exists for dry-run)
- Create: `tests/health.test.ts`

---

#### Interface Contracts

```ts
// src/env.ts
export interface Env {
  DB: D1Database;
  CONFIG: KVNamespace;
  MEDIA: R2Bucket;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  DEV?: string;
}

// src/db/client.ts
export interface DbClient {
  exec(sql: string, ...params: SqlBinding[]): Promise<D1Result>;
  query<T = Record<string, unknown>>(sql: string, ...params: SqlBinding[]): Promise<T[]>;
  queryFirst<T = Record<string, unknown>>(sql: string, ...params: SqlBinding[]): Promise<T | null>;
}
export function createDbClient(d1: D1Database): DbClient;

// src/index.ts
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};
// Hono app with: GET /api/health -> { ok:true, db:"ok" } (reads D1 SELECT 1)
```

`wrangler.toml` must declare: `main = "src/index.ts"`, `compatibility_date = "2024-11-01"` (or current), D1 binding `DB`, KV binding `CONFIG`, R2 binding `MEDIA`, vars, `[assets] directory = "./dist/pwa"`, and mtp-intermediate Migrations dir `migrations_dir = "migrations"`. `package.json` scripts: `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `lint` (biome/eslint), `build:pwa` (`vite build`), `deploy:dryrun` (`wrangler deploy --dry-run`).

#### Test Cases to Cover

**Health endpoint:**
- `GET /api/health` returns 200 with `{ ok: true, db: "ok" }` when D1 is reachable
- Returns 500/error shape when D1 query fails (simulate by stubbing)

**Migrations:**
- Applying `0001_init` + `0002_seed` to a fresh D1 yields tables `decks, models, notes, cards, revlog, enrichments` and a seeded "Default" deck + "Basic" model (field_names `["Front","Back"]`)

#### Layer Guidance

- **Infra:** Install all deps up front so later tasks add none: `hono`, `@hono/node-server` (dev), `jose`, `ts-fsrs`, `@cloudflare/workers-types` (dev), `wrangler` (dev), `vitest` (dev), `@cloudflare/vitest-pool-workers` (dev), `typescript` (dev), `vite` (dev), `@biomejs/biome` or `eslint`+`@typescript-eslint` (dev). Pin a Node-compatible vitest pool for D1.
- **DB schema (`0001_init.sql`):** tables per design §5 (decks, models, notes, cards, revlog, enrichments) with `user_id TEXT NOT NULL` on every table, appropriate indexes (`cards(user_id, due)`, `notes(user_id, guid)`, `notes(user_id, deck_id)`, `enrichments(user_id, note_id)`).
- **Seed (`0002_seed.sql`):** for the single user `user_id = 'local'`: insert "Default" deck and "Basic" model (fields `["Front","Back"]`, one template "Card 1" front/back, css empty).
- **HTTP:** Hono app; health route reads D1 via `createDbClient(env.DB)`.

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run
npx wrangler deploy --dry-run
npm run lint
```

---

## Task 2: Cloudflare Access auth middleware

**Type:** AFK
**Blocked by:** T1
**Layers touched:** Adapter (auth middleware), HTTP

**Goal:** Validate the Cloudflare Access JWT on every request, extracting the user identity into the Hono context, with a DEV bypass for local testing. Make `GET /api/health` require a valid token (vertical verification).

**Acceptance Criteria:**
- [ ] Request with a valid mocked Access JWT → 200, `c.var.user` populated (email + user_id)
- [ ] Request with missing/invalid/expired token → 401
- [ ] `CF_Authorization` cookie fallback also accepted
- [ ] `DEV=1` bypasses validation and sets a fixed local user
- [ ] JWKS fetched from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (mocked in tests)
- [ ] Unit tests with mocked JWKS pass

**Files:**
- Create: `src/auth/access.ts`
- Create: `tests/auth.test.ts`
- Modify: `src/index.ts` (mount global auth middleware before health route)

---

#### Interface Contracts

```ts
// src/auth/access.ts
import type { Env } from "../env";

export interface AuthUser {
  userId: string;   // derived from email (e.g. stable hash) — single user resolves to 'local'
  email: string;
  sub: string;
}

export interface AccessVerifyOptions {
  teamDomain: string;
  aud: string;
  dev?: string;
}

// Returns the verified payload or throws an Error with a message suitable for 401.
export function verifyAccessToken(token: string, opts: AccessVerifyOptions): Promise<AuthUser>;

// Hono middleware factory: reads Cf-Access-Jwt-Assertion header OR CF_Authorization cookie,
// verifies, sets c.var.user. In DEV mode, sets a fixed local user and skips verification.
export function accessAuthMiddleware(): MiddlewareHandler;

// Helper to extract the token from a Request (header first, then cookie).
export function extractAccessToken(request: Request): string | null;

// For tests: build a signed-ish mock JWT helper is NOT required; tests stub verifyAccessToken.
```

#### Test Cases to Cover

**Auth module:**
- Valid token (verifyAccessToken stubbed to resolve) → middleware sets `user`, calls next, response 200
- Missing token (no header, no cookie) → 401 with JSON error
- Invalid token (verifyAccessToken rejects) → 401
- Cookie fallback: no header but `CF_Authorization` cookie present → verified
- DEV bypass: `DEV=1` → 200 with local user, no JWKS fetch

**Integration (via health route):**
- Authenticated `GET /api/health` → 200; unauthenticated → 401

#### Layer Guidance

- Use `jose`'s `createRemoteJWKSet(new URL(\`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs\`))` and `jwtVerify(token, jwks, { audience, issuer })`. Cache the JWSet at module scope.
- `userId`: single-user app → map any verified email to a stable id (e.g. `local`), but reserve a helper `userIdFromEmail(email)` so multi-user is a future swap. Do NOT implement multi-user now.
- Mount middleware globally in `src/index.ts` BEFORE the health route (this is the only wave-2 task editing `index.ts`).

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run tests/auth.test.ts
npm run lint
```

---

## Task 3: FSRS scheduling module

**Type:** AFK
**Blocked by:** T1
**Layers touched:** Domain (scheduling)

**Goal:** Pure scheduling logic wrapping `ts-fsrs`: map a stored card row to an FSRS Card, compute the next state for a rating, and produce the updated card + a revlog entry. No D1 access (pure functions, fully unit-testable).

**Acceptance Criteria:**
- [ ] A new card (State.New) reviewed `Good` → transitions to Review, `due` is a future timestamp, `reps=1`
- [ ] `Again` on a review card → `lapses+1`, due resets to near-now (learning)
- [ ] `Hard`/`Easy` produce sensible intervals (Easy > Good > Hard for a review card)
- [ ] `initNewCard()` returns a card with FSRS New state and a `due = now`
- [ ] All FSRS state fields round-trip through `cardToRow`/`rowToCard` losslessly
- [ ] Unit tests pass without any D1/Workers bindings

**Files:**
- Create: `src/srs/types.ts`
- Create: `src/srs/mapping.ts`
- Create: `src/srs/scheduler.ts`
- Create: `tests/srs.test.ts`

---

#### Interface Contracts

```ts
// src/srs/types.ts
export type Rating = 1 | 2 | 3 | 4; // Again=1, Hard=2, Good=3, Easy=4 (FSRS Rating)

export interface CardRow {
  id: string;
  noteId: string;
  due: number;          // epoch ms
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;        // FSRS State enum (0=New,1=Learning,2=Review,3=Relearning)
  lastReview: number | null;
}

export interface RevlogEntry {
  cardId: string;
  rating: Rating;
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reviewTime: number;   // epoch ms
}

// src/srs/mapping.ts
export function rowToCard(row: CardRow, now: Date): import("ts-fsrs").Card;
export function cardToRow(card: import("ts-fsrs").Card, id: string, noteId: string): CardRow;

// src/srs/scheduler.ts
export function initNewCard(now: Date): CardRow;
export function scheduleReview(row: CardRow, rating: Rating, now: Date): {
  next: CardRow;
  revlog: RevlogEntry;
};
export function previewIntervals(row: CardRow, now: Date): Record<Rating, number>; // for UI "next intervals"
```

#### Test Cases to Cover

- `initNewCard` → state New, due≈now, reps 0
- New + Good → state Review, reps 1, due > now
- New + Again → stays Learning, lapses 0
- Review card + Again → lapses+1, due near now
- Review card: Easy interval > Good interval > Hard interval
- `rowToCard`→`cardToRow` round-trips all numeric fields

#### Layer Guidance

- Wrap `ts-fsrs` `fsrs()` (default v5 params), `createEmptyCard`, `fsrs.repeat(card, now)`. `repeat` returns a map keyed by Rating → `RecordLogItem` with `.card` and `.log`. Pick the item for the given rating.
- Keep this module free of D1/Hono so it is trivially unit-testable in Node (no Workers pool needed).

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run tests/srs.test.ts
npm run lint
```

---

## Task 4: LLM enrichment client module

**Type:** AFK
**Blocked by:** T1
**Layers touched:** Adapter (LLM gateway)

**Goal:** Pure client that calls an OpenAI-compatible `/chat/completions` endpoint to produce structured enrichment for a note. Gracefully reports "not configured" when secrets are absent. No Hono, no D1.

**Acceptance Criteria:**
- [ ] With `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` set → returns enrichment object for given word+fields
- [ ] When any required config missing → throws `LlmNotConfiguredError` (caller maps to 503)
- [ ] Upstream API error → throws `LlmRequestError` with status
- [ ] Mocked `fetch` tests verify request shape (model, messages, temperature) and response parsing
- [ ] Unit tests pass without network

**Files:**
- Create: `src/llm/types.ts`
- Create: `src/llm/prompts.ts`
- Create: `src/llm/client.ts`
- Create: `tests/llm-client.test.ts`

---

#### Interface Contracts

```ts
// src/llm/types.ts
export interface NoteInput { word: string; fields: Record<string, string>; }
export interface Enrichment {
  exampleSentence: string;
  extendedDefinition: string;
  mnemonic: string;
}
export interface LlmConfig { apiKey: string; baseUrl: string; model: string; }
export class LlmNotConfiguredError extends Error {}
export class LlmRequestError extends Error { status: number; }

// src/llm/prompts.ts
export function buildEnrichmentPrompt(note: NoteInput): { system: string; user: string };

// src/llm/client.ts
export function readLlmConfig(env: Pick<Env, "LLM_API_KEY" | "LLM_BASE_URL" | "LLM_MODEL">): LlmConfig | null;
export async function enrichNote(note: NoteInput, config: LlmConfig, fetchImpl?: typeof fetch): Promise<Enrichment>;
```

#### Test Cases to Cover

- `readLlmConfig` returns null when any of the three missing
- `enrichNote` posts to `${baseUrl}/chat/completions` with Bearer key, correct model, messages from `buildEnrichmentPrompt`, parses `choices[0].message.content` (JSON) into `Enrichment`
- Throws `LlmRequestError` on non-2xx
- Throws on malformed JSON content

#### Layer Guidance

- Use the global `fetch` (Workers-compatible). Allow `fetchImpl` injection for tests.
- Prompt instructs the model to return strict JSON matching `Enrichment`; client parses (tolerant: strip code fences if present).

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run tests/llm-client.test.ts
npm run lint
```

---

## Task 5: Ankiconnect read actions

**Type:** AFK
**Blocked by:** T1, T2
**Layers touched:** Adapter (HTTP sub-app), DB (read repos)

**Goal:** Deliver the read-only Ankiconnect actions end-to-end: `version`, `deckNames`, `modelNames`, `modelFieldNames`, `modelTemplates`, `modelStyling`. A Hono sub-app `createAnkiconnectApp({ db })` handles `POST /` dispatching `{action, version, params}` → `{result, error}`.

**Acceptance Criteria:**
- [ ] `version` → `{result: 6, error: null}`
- [ ] `deckNames` → `{result: ["Default"], error: null}` (after seed)
- [ ] `modelNames` → includes `"Basic"`
- [ ] `modelFieldNames {modelName:"Basic"}` → `["Front","Back"]`
- [ ] `modelTemplates {modelName:"Basic"}` → `{"Card 1": {Front:"...", Back:"..."}}`
- [ ] `modelStyling {modelName:"Basic"}` → `{css: "..."}`
- [ ] Unknown action → `{result: null, error: "unsupported action: X"}`
- [ ] All via a test harness mounting the sub-app + auth middleware against seeded D1

**Files:**
- Create: `src/ankiconnect/router.ts`
- Create: `src/ankiconnect/actions/version.ts`
- Create: `src/ankiconnect/actions/deckNames.ts`
- Create: `src/ankiconnect/actions/modelNames.ts`
- Create: `src/ankiconnect/actions/modelFieldNames.ts`
- Create: `src/ankiconnect/actions/modelTemplates.ts`
- Create: `src/ankiconnect/actions/modelStyling.ts`
- Create: `src/db/repos/decks.ts`
- Create: `src/db/repos/models.ts`
- Create: `tests/ankiconnect-read.test.ts`

---

#### Interface Contracts

```ts
// src/ankiconnect/router.ts
export interface AnkiDeps { db: DbClient; }
export function createAnkiconnectApp(deps: AnkiDeps): Hono;
// POST "/" body {action, version, params} -> {result, error} JSON

// Each action file exports a handler:
export interface ActionCtx { db: DbClient; userId: string; params: Record<string, unknown>; }
export interface ActionResult { result: unknown; error: string | null; }
// e.g. src/ankiconnect/actions/deckNames.ts
export async function deckNamesAction(ctx: ActionCtx): Promise<ActionResult>;

// src/db/repos/decks.ts
export function listDeckNames(db: DbClient, userId: string): Promise<string[]>;

// src/db/repos/models.ts
export function listModelNames(db: DbClient, userId: string): Promise<string[]>;
export function getModel(db: DbClient, userId: string, modelName: string): Promise<ModelRow | null>;
export interface ModelRow { id: string; name: string; fieldNames: string[]; templates: Record<string, { Front: string; Back: string }>; css: string; }
```

#### Test Cases to Cover

- Each action returns the correct `result`/`error` shape (see Acceptance)
- `modelFieldNames`/`modelTemplates`/`modelStyling` with unknown modelName → `error` (not a crash)
- Dispatch is action-name based; `version` does not touch DB

#### Layer Guidance

- Router: single `POST "/"` route reads body, looks up action in a `Map<string, ActionHandler>`, calls it with `{db, userId: c.var.user.userId, params}`. Return `{result, error}` with 200 even on logical errors (Ankiconnect convention).
- Repos: thin D1 queries scoped by `userId`. JSON columns (`field_names`, `templates`) parsed in the repo.

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run tests/ankiconnect-read.test.ts
npm run lint
```

---

## Task 6: Ankiconnect write actions

**Type:** AFK
**Blocked by:** T5, T3
**Layers touched:** Adapter (HTTP sub-app), DB (write repos), Domain (SRS init)

**Goal:** Add `addNote`, `canAddNotes`, `findNotes` to the Ankiconnect sub-app. `addNote` creates a note + card(s) with an FSRS-initialized card state; accepts `audio`/`video`/`picture` fields without error (media deferred). `canAddNotes` returns per-note booleans via guid/first-field dedup. `findNotes` supports minimal query parsing.

**Acceptance Criteria:**
- [ ] `addNote {note:{deckName,modelName,fields,tags}}` → `{result: <noteId>, error: null}` and a card row exists with FSRS New state
- [ ] `addNote` with `audio`/`video`/`picture` arrays → still succeeds, no R2 writes, no error
- [ ] `addNote` with unknown deck/model → `{result:null, error:"..."}`
- [ ] `canAddNotes {notes:[...]}` → `[true,false,...]`; duplicates (same guid or first field in deck) → false
- [ ] `findNotes {query:"deck:Default Front:cat"}` → `[<noteId>...]` (minimal parser; unknown tokens ignored gracefully)
- [ ] New card created by `addNote` uses `initNewCard()` from T3
- [ ] Tests via sub-app + auth harness against D1

**Files:**
- Modify: `src/ankiconnect/router.ts` (register write actions in the dispatch map)
- Create: `src/ankiconnect/actions/addNote.ts`
- Create: `src/ankiconnect/actions/canAddNotes.ts`
- Create: `src/ankiconnect/actions/findNotes.ts`
- Create: `src/db/repos/notes.ts`
- Create: `src/db/repos/cards-create.ts`
- Create: `tests/ankiconnect-write.test.ts`

---

#### Interface Contracts

```ts
// src/ankiconnect/actions/addNote.ts
export interface AddNoteParams {
  note: {
    deckName: string; modelName: string;
    fields: Record<string, string>;
    tags?: string[];
    options?: { allowDuplicate?: boolean; duplicateScope?: string };
    audio?: unknown[]; video?: unknown[]; picture?: unknown[]; // accepted, ignored (media deferred)
  };
}
export async function addNoteAction(ctx: ActionCtx & { userId: string }): Promise<ActionResult>; // result: string (noteId)

// src/db/repos/notes.ts
export interface NoteRow { id: string; userId: string; deckId: string; modelId: string; fields: Record<string,string>; tags: string[]; guid: string; createdAt: number; updatedAt: number; }
export async function createNote(db: DbClient, userId: string, input: { deckId: string; modelId: string; fields: Record<string,string>; tags: string[]; guid: string }): Promise<NoteRow>;
export async function getNoteById(db: DbClient, userId: string, noteId: string): Promise<NoteRow | null>;
export async function findDuplicate(db: DbClient, userId: string, deckId: string, firstField: string): Promise<boolean>;
export async function findNotesByQuery(db: DbClient, userId: string, query: string): Promise<string[]>;

// src/db/repos/cards-create.ts
export async function createCardsForNote(db: DbClient, userId: string, note: NoteRow, templates: Record<string,{Front:string;Back:string}>): Promise<string[]>; // returns card ids, each init via initNewCard()
```

#### Test Cases to Cover

- `addNote` Basic note → note + 1 card (Basic has 1 template) with FSRS New state, `due≈now`
- `addNote` ignores media arrays, still 200 + noteId
- Duplicate (same first field in same deck) with `allowDuplicate:false` → `addNote` returns error; `canAddNotes` returns false for that note
- `canAddNotes` returns array length == input length, booleans correct
- `findNotes {query:"deck:Default"}` returns ids of notes in that deck; `{query:"Front:cat"}` filters by first field; malformed query → empty list, no crash

#### Layer Guidance

- `guid`: derive deterministically from `(userId, deckId, modelId, firstField)` so duplicates are detectable without Anki's native guid. Accept a caller-provided guid if present.
- `createCardsForNote`: one card per template key, each initialized via `initNewCard(now)` (T3).
- `findNotesByQuery`: parse simple `key:value` tokens; support `deck:` (name→id) and a bare token matching the model's first field. Keep it minimal and documented as "Yomitan dup-detection subset".

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run tests/ankiconnect-write.test.ts tests/ankiconnect-read.test.ts
npm run lint
```

---

## Task 7: Review API (due / submit / quiz / familiar)

**Type:** AFK
**Blocked by:** T1, T2, T3
**Layers touched:** Adapter (HTTP sub-app), DB (review repos), Domain (SRS)

**Goal:** Internal review API consumed by the PWA: fetch due cards, submit a review rating (advances FSRS state + writes revlog), fetch a random quiz set, and mark a card/note as "familiar".

**Acceptance Criteria:**
- [ ] `GET /api/review/due?deck=&limit=` → list of due/new cards (front/back fields, noteId, cardId)
- [ ] `POST /api/review/submit {cardId, rating}` → updates card via `scheduleReview` (T3), inserts revlog, returns `{due}`
- [ ] `GET /api/review/quiz?deck=&limit=` → random cards (for测验)
- [ ] `POST /api/review/familiar {noteId}` → marks note familiar (tag `known` or flag) and returns ok
- [ ] Submitting `Again` makes the card due again soon; `Good` pushes due into the future
- [ ] All endpoints require auth; scoped by `userId`
- [ ] Tests seed cards via SQL (no dependency on `addNote`)

**Files:**
- Create: `src/review/router.ts`
- Create: `src/review/routes/due.ts`
- Create: `src/review/routes/submit.ts`
- Create: `src/review/routes/quiz.ts`
- Create: `src/review/routes/familiar.ts`
- Create: `src/db/repos/cards-review.ts`
- Create: `src/db/repos/revlog.ts`
- Create: `tests/review.test.ts`

---

#### Interface Contracts

```ts
// src/review/router.ts
export interface ReviewDeps { db: DbClient; }
export function createReviewApp(deps: ReviewDeps): Hono; // mounted at /api/review

// src/db/repos/cards-review.ts
export interface ReviewCardView { cardId: string; noteId: string; deckName: string; modelName: string; fields: Record<string,string>; tags: string[]; state: number; due: number; }
export async function listDueCards(db: DbClient, userId: string, opts: { deckName?: string; limit: number; now: number }): Promise<ReviewCardView[]>;
export async function listRandomCards(db: DbClient, userId: string, opts: { deckName?: string; limit: number }): Promise<ReviewCardView[]>;
export async function getCardForReview(db: DbClient, userId: string, cardId: string): Promise<CardRow | null>;
export async function updateCardAfterReview(db: DbClient, userId: string, cardId: string, next: CardRow): Promise<void>;

// src/db/repos/revlog.ts
export async function insertRevlog(db: DbClient, userId: string, entry: RevlogEntry): Promise<void>;
```

#### Test Cases to Cover

- `due` returns new + due cards up to limit, ordered by due
- `submit` Good on a new card → card state Review, due future; revlog row written
- `submit` Again on a review card → lapses+1, due near now
- `submit` unknown cardId → 404
- `quiz` returns up to `limit` random cards from the deck
- `familiar` marks the note (e.g., adds tag `known`); subsequent `due` can exclude familiar (per a query flag, optional) — at minimum the mark persists

#### Layer Guidance

- `submit`: load `CardRow` → `scheduleReview(row, rating, now)` (T3) → `updateCardAfterReview` + `insertRevlog` in a single D1 transaction (`db.exec("BEGIN")`/`COMMIT`) where supported.
- `familiar`: store as a tag `known` on the note (reuses notes.tags JSON) — simplest, no schema change.
- Routes read `c.var.user.userId` from the auth middleware.

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run tests/review.test.ts
npm run lint
```

---

## Task 8: LLM enrich endpoint

**Type:** AFK
**Blocked by:** T6, T4, T2
**Layers touched:** Adapter (HTTP sub-app), DB (enrichments repo)

**Goal:** `POST /api/notes/:id/enrich` fetches the note, calls the LLM client (T4), stores the result in `enrichments`, and returns it. Returns 503 when LLM is not configured.

**Acceptance Criteria:**
- [ ] With LLM configured → 200, returns `Enrichment`, persists a row in `enrichments`
- [ ] Without LLM config → 503 `{ error: "llm not configured" }`
- [ ] Unknown noteId → 404
- [ ] LLM upstream error → 502 with message
- [ ] Re-enriching a note overwrites (or adds a new row keyed by kind) — pick overwrite-by-kind
- [ ] Requires auth; scoped by `userId`

**Files:**
- Create: `src/llm/router.ts`
- Create: `src/db/repos/enrichments.ts`
- Create: `tests/llm-enrich.test.ts`

---

#### Interface Contracts

```ts
// src/llm/router.ts
export function createLlmApp(deps: { db: DbClient; env: Env }): Hono; // mounted at /api
// POST /notes/:id/enrich -> Enrichment | error

// src/db/repos/enrichments.ts
export async function saveEnrichment(db: DbClient, userId: string, noteId: string, kind: string, content: Enrichment): Promise<void>;
export async function getEnrichment(db: DbClient, userId: string, noteId: string, kind: string): Promise<Enrichment | null>;
```

#### Test Cases to Cover

- Configured + existing note → 200, `enrichments` row exists, response is `Enrichment`
- Not configured → 503
- Missing note → 404
- LLM throws `LlmRequestError` → 502
- Mock `enrichNote` via injected fetch or by stubbing the client

#### Layer Guidance

- Use `getNoteById` (T6, `src/db/repos/notes.ts`) to load the note; build `NoteInput` from its fields (use a `word` field or the first field).
- `kind = "default"` for now (future: multiple enrichment kinds).
- Inject the LLM client function so tests can stub it without `fetch`.

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run tests/llm-enrich.test.ts
npm run lint
```

---

## Task 9: PWA (review / quiz / familiar UI)

**Type:** AFK
**Blocked by:** T1
**Layers touched:** UI (PWA), Adapter (fetch to internal API)

**Goal:** A Vite-built vanilla-TS PWA under `pwa/` that builds to `dist/pwa/` (served by Workers Assets). Screens: review (due cards, flip, 4 rating buttons), random quiz, familiar-words list. Calls the internal review API (`/api/review/*`) and the enrich endpoint (`/api/notes/:id/enrich`). Installable (manifest + service worker).

**Acceptance Criteria:**
- [ ] `npm run build:pwa` succeeds and outputs `dist/pwa/` with `index.html`, `manifest.webmanifest`, bundled JS/CSS, and `sw.js`
- [ ] Manifest is valid (name, short_name, icons, display standalone, theme/background)
- [ ] Service worker registers and caches the app shell
- [ ] Review screen: fetches `/api/review/due`, shows front, flips to back, 4 rating buttons POST `/api/review/submit`
- [ ] Quiz screen: fetches `/api/review/quiz`, shows a card, self-check reveal
- [ ] Familiar screen: lists notes tagged `known`; button to mark familiar via `/api/review/familiar`
- [ ] "Enrich" button on a card POSTs `/api/notes/:id/enrich` and displays result (handles 503 gracefully)
- [ ] At least one unit test for a pure UI helper (e.g., query-string builder, rating button labels)

**Files:**
- Create: `pwa/package.json` is NOT needed (use root scripts); Create: `pwa/vite.config.ts`
- Create: `pwa/index.html`
- Create: `pwa/src/main.ts`
- Create: `pwa/src/api.ts`
- Create: `pwa/src/review.ts`
- Create: `pwa/src/quiz.ts`
- Create: `pwa/src/familiar.ts`
- Create: `pwa/src/styles.css`
- Create: `pwa/public/manifest.webmanifest`
- Create: `pwa/public/sw.js`
- Create: `pwa/public/icon.svg` (and 192/512 pngs or note as manual)
- Create: `tests/pwa-helpers.test.ts`

---

#### Interface Contracts

```ts
// pwa/src/api.ts — typed wrappers around internal API (contracts must match T7/T8)
export async function fetchDue(deckName?: string, limit = 20): Promise<ReviewCardView[]>;
export async function submitReview(cardId: string, rating: 1|2|3|4): Promise<{ due: number }>;
export async function fetchQuiz(deckName?: string, limit = 10): Promise<ReviewCardView[]>;
export async function markFamiliar(noteId: string): Promise<void>;
export async function enrichNote(noteId: string): Promise<Enrichment | { error: string }>;
```

`ReviewCardView` and `Enrichment` types are mirrored from the backend (define local PWA types to avoid importing server code; keep them in sync via comments).

#### Test Cases to Cover

- `api.ts` query-string builder produces correct URLs (`?deck=Default&limit=20`)
- Rating button mapping (Again/Hard/Good/Easy → 1/2/3/4)
- Enrich 503 path renders a friendly message (DOM test or pure render function test)

#### Layer Guidance

- Vanilla TS + Vite; no framework. Minimal DOM manipulation. `base` in vite config so assets resolve under the Worker route.
- The PWA runs same-origin as the Worker, so it inherits the Access cookie (browser sessions). No explicit auth UI needed in MVP (the Zero Trust login happens when visiting the domain).
- `sw.js`: cache-first for the shell, network-first for API (or skip caching API). Keep simple.

---

#### Validation

```bash
npm run build:pwa
npx vitest run tests/pwa-helpers.test.ts
```

---

## Task 10: App wiring + E2E (Yomitan sequence + review flow) + assets finalize

**Type:** AFK
**Blocked by:** T2, T5, T6, T7, T8, T9
**Layers touched:** Adapter (HTTP assembly), E2E

**Goal:** Mount all sub-apps into `src/index.ts` (auth global, Ankiconnect at `POST /`, review at `/api/review`, LLM at `/api`, health at `/api/health`), finalize Workers Assets serving for the PWA, and add full-app E2E tests: the Yomitan connection sequence and a review flow.

**Acceptance Criteria:**
- [ ] `src/index.ts` mounts: `accessAuthMiddleware()` globally; `app.route("/", createAnkiconnectApp(...))`; `app.route("/api/review", createReviewApp(...))`; `app.route("/api", createLlmApp(...))`; `GET /api/health` preserved
- [ ] `GET /` serves the PWA `index.html` (Workers Assets); `POST /` reaches Ankiconnect
- [ ] E2E test "Yomitan sequence" passes: `version` → `deckNames` → `modelNames` → `modelFieldNames{Basic}` → `canAddNotes{[one Basic note]}` → `addNote{Basic note}` → assert noteId returned + card exists + `findNotes{deck:Default}` returns it
- [ ] E2E test "review flow" passes: seed/add a card → `GET /api/review/due` returns it → `POST /api/review/submit{rating:3}` → `due` moves to future → `GET /api/review/due` no longer returns it (until due)
- [ ] `npx tsc --noEmit`, `npx vitest run` (full suite), `npx wrangler deploy --dry-run`, `npm run lint` all green
- [ ] CORS headers present on Ankiconnect responses (permissive origin, OPTIONS handled) for browser-extension calls

**Files:**
- Modify: `src/index.ts`
- Modify: `wrangler.toml` (finalize assets config if needed)
- Create: `src/cors.ts` (CORS middleware for the Ankiconnect route)
- Create: `tests/e2e/yomitan-sequence.test.ts`
- Create: `tests/e2e/review-flow.test.ts`

---

#### Interface Contracts

```ts
// src/cors.ts
export function corsMiddleware(): MiddlewareHandler; // permissive origin, handles OPTIONS preflight

// src/index.ts (final)
// app.use("*", accessAuthMiddleware());
// app.use("/api/health", healthRoute);
// app.route("/", createAnkiconnectApp({db}))  // with corsMiddleware for POST /
// app.route("/api/review", createReviewApp({db}))
// app.route("/api", createLlmApp({db, env}))
```

#### Test Cases to Cover

**Yomitan sequence (full app, auth stubbed to a local user via DEV):**
- `POST / {action:"version"}` → `{result:6}`
- `POST / {action:"deckNames"}` → contains "Default"
- `POST / {action:"modelNames"}` → contains "Basic"
- `POST / {action:"modelFieldNames", params:{modelName:"Basic"}}` → ["Front","Back"]
- `POST / {action:"canAddNotes", params:{notes:[{deckName:"Default",modelName:"Basic",fields:{Front:"cat",Back:"猫"}}]}}` → [true]
- `POST / {action:"addNote", params:{note:{deckName:"Default",modelName:"Basic",fields:{Front:"cat",Back:"猫"}}}}` → number noteId
- `POST / {action:"findNotes", params:{query:"deck:Default"}}` → includes the new noteId
- Second `canAddNotes` for the same first field → [false] (duplicate)

**Review flow (full app):**
- After addNote (or SQL seed), `GET /api/review/due` returns the card
- `POST /api/review/submit {cardId, rating:3}` → 200, `due` in the future
- `GET /api/review/due` no longer lists it (until due)
- `POST /api/review/familiar {noteId}` → 200; note tagged `known`

#### Layer Guidance

- Use DEV-mode auth (no real Access token) in E2E by setting `DEV=1` in the test env. Real Zero Trust validation is unit-tested in T2.
- CORS only on the Ankiconnect route (Yomitan cross-origin). Internal `/api/*` is same-origin (PWA) so strict/no-extra CORS needed, but OPTIONS should still return 204.
- `POST /` vs Workers Assets: assets serve `GET /` (index.html); `POST /` falls through to the Worker (Ankiconnect). Verify this in the E2E.

---

#### Validation

```bash
npx tsc --noEmit
npx vitest run
npx wrangler deploy --dry-run
npm run lint
npm run build:pwa
```

---

## Plan Coverage Checklist

- [x] Every approved requirement maps to at least one task
  - Ankiconnect subset → T5, T6, T10 (E2E)
  - D1/KV/R2 bindings → T1 (bindings); R2 media deferred (accepted in T6, no upload)
  - Cloudflare Zero Trust auth → T2
  - FSRS scheduling → T3, T7
  - PWA review/quiz/familiar → T9, T7
  - On-demand LLM enrichment → T4, T8
- [x] Every task has clear acceptance criteria
- [x] Every task lists behavior-focused test cases
- [x] Every task lists exact Create/Modify file paths
- [x] New or modified API endpoints have E2E test task(s) — T10 (Yomitan sequence + review flow); per-task integration tests in T5/T6/T7/T8 via sub-app harness
- [x] The dependency graph has no cycles (T1 ← {T2,T3,T4,T9} ← T5/T7 ← T6 ← T8 ← T10)
- [x] Parallelizable tasks do not modify the same files (verified per-wave: shared files `src/index.ts`/`wrangler.toml`/`package.json` owned by T1 and only re-edited by T10 serial)
- [x] No task is purely horizontal unless unavoidable infrastructure — T1 is infra+vertical (health endpoint); all others are vertical slices
- [x] Known assumptions or deviations documented:
  - Validation commands adapted from Go defaults to TS/Workers stack (`tsc`, `vitest`, `wrangler --dry-run`, lint).
  - Media upload to R2 deferred (T6 accepts media fields without error; R2 binding present but unused this build).
  - `userId` reserved for future multi-user; single user maps to a stable local id.
  - Real Yomitan extension smoke test is a manual step beyond CI (E2E simulates its request sequence).
  - PWA shares origin with the Worker, inheriting the Zero Trust browser session.

## Execution Handoff

Proceeding automatically to /skill:subagent-driven-development (no confirmation, per `/go` pipeline):
- Fresh subagent per task, wave-parallel execution using the dependency graph above.
- Spec-compliance review gate per task; global architecture/quality review at the end (Step 4 of `/go`).
- Run plan preflight before dispatching implementers; run per-wave validation (`tsc`/`vitest`/`lint`) and the full suite + `wrangler --dry-run` at T10.
