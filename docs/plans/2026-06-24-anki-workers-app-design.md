# Design: Anki-compatible Cloudflare Workers vocab app

- **Date**: 2026-06-24
- **Status**: Approved (locked)
- **Pipeline**: `go` — Full Pipeline

## 1. Goal

A Cloudflare Workers app that acts as a self-hosted, Anki-compatible vocabulary backend:

- Provides an **Ankiconnect-compatible API** so the **Yomitan** browser extension can add word cards directly (Worker is the canonical Anki backend — no desktop Anki dependency).
- Uses **Cloudflare D1 / KV / R2** bindings.
- Secured by **Cloudflare Zero Trust (Access)** identity.
- Optional **OpenAI-compatible LLM** enriches cards on demand.
- A **PWA** for reviewing vocabulary, marking familiar words, and random quizzes, with **FSRS** scheduling.

## 2. Locked requirements (from brainstorming)

| Decision | Choice |
|---|---|
| User scope | Single-user; data model reserves `user_id` for future multi-user |
| Worker role | Worker IS the Anki backend (Yomitan adds directly) |
| API scope | Yomitan-required Ankiconnect subset only |
| Review model | Full SRS — FSRS (via `ts-fsrs`) |
| Tech stack | TypeScript + Hono + Wrangler |
| Media / R2 | Deferred this round (addNote accepts media fields without error; no R2 upload) |
| LLM | On-demand, triggered from PWA during review |
| Build scope | Full (MVP core + on-demand LLM enrichment in one pipeline) |

## 3. Architecture overview

A single **Cloudflare Worker (Hono)** serves the Ankiconnect API, an internal review API, and PWA static assets. **Cloudflare Zero Trust (Access)** fronts the route; the Worker validates the Access JWT for defense-in-depth.

- **Bindings**: `DB` (D1, source of truth), `CONFIG` (KV, per-user settings/cache), `MEDIA` (R2, present but media upload deferred), plus secrets.
- **Request flow (Yomitan)**: user logs into the app domain via Access in-browser (sets `CF_Authorization` cookie) → Yomitan's same-browser fetches carry the cookie → Cloudflare edge authenticates and injects `Cf-Access-Jwt-Assertion` header → Worker validates → Ankiconnect handler.
- **CORS**: permissive (API is auth-protected) + OPTIONS preflight (Yomitan calls cross-origin from the browser).

## 4. Module layout

```
src/index.ts              # Hono entry, route mounting, middleware
src/auth/access.ts        # Cloudflare Access JWT validation (jose + JWKS)
src/ankiconnect/router.ts # dispatch action -> handler ({result,error})
src/ankiconnect/actions/  # version, deckNames, modelNames, modelFieldNames,
                          # modelTemplates, modelStyling, addNote, canAddNotes, findNotes
src/db/                   # schema, migrations, repository layer
src/srs/                  # FSRS scheduling (ts-fsrs) + review state service
src/review/               # internal review API: due cards, submit review, quiz, familiar
src/llm/                  # OpenAI-compatible client + enrichment prompts
src/pwa/                  # PWA assets (review/quiz/familiar UI), manifest, SW
migrations/*.sql          # D1 migrations
tests/                    # vitest unit + @cloudflare/vitest-pool-workers integration/e2e
wrangler.toml             # bindings, vars, secrets refs
```

## 5. Data model (D1; `user_id` reserved for multi-user)

- `decks(id, user_id, name, created_at)` — unique `(user_id,name)`; "Default" seeded.
- `models(id, user_id, name, field_names JSON, templates JSON, css, type, created_at)` — note types; seed "Basic" (Front/Back).
- `notes(id, user_id, deck_id, model_id, fields JSON, tags JSON, guid, created_at, updated_at)` — `guid` for dedup.
- `cards(id, user_id, note_id, deck_id, template_ord, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, created_at)` — FSRS state per card.
- `revlog(id, user_id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, review_time, created_at)`.
- `enrichments(id, user_id, note_id, kind, content, created_at)` — LLM output.
- KV `CONFIG`: FSRS params, LLM config, per-user settings. R2 `MEDIA`: present, unused this round.

## 6. Ankiconnect API subset (locked)

`POST /` (Yomitan server URL) → `{action, version, params}` → `{result, error}`.

| action | behavior |
|---|---|
| `version` | → `6` |
| `deckNames` | list decks |
| `modelNames` | list models |
| `modelFieldNames` {modelName} | field list |
| `modelTemplates` {modelName} | `{Card 1:{Front,Back}}` |
| `modelStyling` {modelName} | `{css}` |
| `addNote` {note} | create note+card(s), return noteId; accepts `audio/video/picture` but does **not** upload (deferred) — no error |
| `canAddNotes` {notes} | `[bool…]` via guid/first-field dedup |
| `findNotes` {query} | minimal query parse (`deck:`, first-field) for Yomitan dup detection |

**Media this round**: deferred — `addNote` ignores media upload, keeps text fields, returns success. R2 binding exists for a later phase.

## 7. Auth (Cloudflare Zero Trust)

- Access protects the route; edge injects `Cf-Access-Jwt-Assertion`. Middleware validates with `jose` `createRemoteJWKSet` from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (keys rotate ~6wk → fetched dynamically), checks `aud` (env `CF_ACCESS_AUD`) + `iss`, extracts `email`→`user_id`.
- Also accepts `CF_Authorization` cookie fallback for browser/extension requests.
- Local dev bypass via `DEV=1` (skip validation) for testing with Yomitan locally.
- Secrets: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`; optional `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`.

## 8. SRS (FSRS via `ts-fsrs`)

- Card holds FSRS state; ratings Again/Hard/Good/Easy → `ts-fsrs` `Rating`; `fsrs.repeat(card, now)` updates state + writes `revlog`.
- New→Learning→Review transitions; default FSRS v5 params; per-user params in KV (future).
- Use the `ts-fsrs` library (canonical, pure-TS, Workers-safe) rather than reimplementing.

## 9. PWA (review/quiz/familiar)

- Served from the Worker via Workers Assets. Vanilla TS + Vite bundle (light, no heavy framework).
- **Review**: due cards, flip, 4 rating buttons → internal review API (`/api/review/*`), not Ankiconnect.
- **Quiz**: random cards from deck/tag set.
- **Familiar words**: list + mark "已熟悉" (flag/tag on card).
- Installable: manifest + service worker (online review in MVP; offline future).

## 10. LLM enrichment (on-demand)

- `POST /api/notes/:id/enrich` → OpenAI-compatible chat completion (word + fields → example sentence / extended definition / mnemonic) → stored in `enrichments`, surfaced in PWA.
- Prompt template + provider config in KV/env. Graceful 503 when unconfigured.

## 11. Testing & validation (adapted `go`→TS)

- Unit/integration: Vitest + `@cloudflare/vitest-pool-workers` (Miniflare D1). Mocked JWKS + LLM fetch.
- **E2E (mandatory for API)**: scripted "Yomitan connection sequence" — `version→deckNames→modelNames→modelFieldNames→canAddNotes→addNote` — asserting correct shapes. Real-Yomitan smoke test documented as a manual step.
- Validation gates: `npx tsc --noEmit` · `npx vitest run` · `npx wrangler deploy --dry-run` · lint.

## 12. Scope (this build = full)

In-scope: auth, Ankiconnect subset, D1 schema+migrations, FSRS scheduling, internal review API, PWA (review/quiz/familiar), on-demand LLM enrichment.
**Deferred**: media upload to R2 (interface only), per-user FSRS optimization, offline PWA sync.

## 13. Assumptions

- User has a Cloudflare account and provisions D1/KV/R2/Access + sets secrets; the project provides `wrangler.toml` + setup docs.
- Single user; `user_id` reserved for future multi-user.
- Validation commands adapted from Go defaults to the TypeScript/Workers stack (`tsc`, `vitest`, `wrangler --dry-run`, lint).
